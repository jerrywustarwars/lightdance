"""
身份驗證：密碼雜湊與存取權杖。

這個檔案存在的理由，先看它取代掉的東西：

```python
# 舊的 /api/token
if not form_data.password == user.password:      # 明文比對
    raise HTTPException(...)
return {"access_token": user.username}           # 權杖 = 使用者名稱

# 舊的驗證
def decode_token(token):
    return get_user(user_list, token)            # 拿權杖當使用者名稱去查
```

第二段才是嚴重的那一個：**權杖就是使用者名稱本身**，而驗證只是拿它去查有沒有
這個人。也就是說任何人只要送 `Authorization: Bearer <某個帳號名>` 就通過了，
密碼完全不需要。那不是「權杖機制不夠安全」，是**整條驗證等於沒有**——
帳號名稱不是秘密，它會出現在網址、截圖、彼此喊人的訊息裡。

現在：

- 密碼用 **bcrypt** 存（cost 12）。舊的明文密碼**登入成功時就地換成雜湊**，
  不需要停機、不需要遷移腳本、也不會有人被鎖在外面（見 `verify_password`）。
- 權杖是 **HS256 簽章的 JWT**，帶 `sub`（使用者）與 `exp`（有效期）。
  簽章驗不過或過期就不是合法權杖，而不是「查得到這個人就算數」。

## 秘鑰

`AUTH_SECRET` 環境變數。沒設的話啟動時**當場產生一把並印出警告**——這讓開發
環境不必先設定就跑得起來，代價是重開服務之後舊權杖全部失效（使用者要重新登入
一次）。正式環境務必設好，否則每次重啟大家都會被登出。

刻意不給一個寫死的預設值：那種預設值會原封不動地上正式環境，而且因為
「它能動」所以沒有人會發現。
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"

#: 權杖有效期。一場排練不會超過這個長度，過期就重新登入。
TOKEN_TTL_HOURS = int(os.getenv("AUTH_TOKEN_TTL_HOURS", "12"))

#: bcrypt 的成本參數。12 在一般機器上約 0.2~0.3 秒——慢到讓暴力破解不划算，
#: 又不會讓登入卡住。調高要連帶考慮登入的等待時間。
BCRYPT_ROUNDS = 12


def _load_secret() -> str:
    secret = os.getenv("AUTH_SECRET")
    if secret:
        return secret

    generated = secrets.token_urlsafe(32)
    logger.warning(
        "AUTH_SECRET 沒有設定，這次啟動臨時產生了一把。"
        "服務重啟後所有人都要重新登入；正式環境請把 AUTH_SECRET 設進環境變數。"
    )
    return generated


SECRET = _load_secret()


# ---------------------------------------------------------------------------
# 密碼
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    """把明文密碼變成 bcrypt 雜湊（含 salt，字串形式可直接存進 mongo）。"""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def is_hashed(stored: str) -> bool:
    """這個欄位存的是雜湊還是明文？bcrypt 的字串一律以 `$2` 開頭。"""
    return isinstance(stored, str) and stored.startswith("$2")


def verify_password(plain: str, stored: str) -> bool:
    """
    驗證密碼，同時相容**還沒被換掉的明文舊資料**。

    這是懶惰遷移（lazy migration）的一半：舊帳號的密碼欄位還是明文，直接改成
    只認雜湊的話那些人全部登不進來。所以這裡兩種都認，呼叫端再依
    `needs_rehash()` 決定要不要把它就地換成雜湊（見 main.py 的 /api/token）。

    明文比對用 `secrets.compare_digest` 而不是 `==`：兩者結果一樣，但前者的
    執行時間不隨「前幾個字元對了幾個」變化。這條路徑遲早會消失（每個人登入
    一次就換成雜湊了），在那之前沒有理由留一個時間側通道。

    ⚠️ 比的是 **bytes 不是 str**：`compare_digest` 收到含非 ASCII 字元的字串會
    直接丟 `TypeError`，而密碼是使用者自己取的，裡面有中文完全合理。
    先前寫成比 str，任何一個密碼含中文的人登入都會拿到 500 而不是「密碼錯誤」
    ——這是自己的測試抓到的，用一個中文的錯誤密碼就踩到了。
    """
    if not isinstance(stored, str) or not stored:
        return False

    if is_hashed(stored):
        try:
            return bcrypt.checkpw(plain.encode("utf-8"), stored.encode("utf-8"))
        except ValueError:
            # 欄位看起來像雜湊但其實是壞的（手動改過資料庫之類）
            return False

    return secrets.compare_digest(plain.encode("utf-8"), stored.encode("utf-8"))


def needs_rehash(stored: str) -> bool:
    """這筆密碼還是明文，登入成功時該就地換成雜湊。"""
    return not is_hashed(stored)


# ---------------------------------------------------------------------------
# 權杖
# ---------------------------------------------------------------------------

def create_access_token(username: str, ttl_hours: int | None = None) -> str:
    """簽一張帶有效期的權杖。"""
    hours = TOKEN_TTL_HOURS if ttl_hours is None else ttl_hours
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "iat": now,
        "exp": now + timedelta(hours=hours),
    }
    return jwt.encode(payload, SECRET, algorithm=ALGORITHM)


def read_token(token: str) -> str | None:
    """
    驗證權杖並取出使用者名稱；不合法或過期回傳 None。

    **不要在這裡放寬條件。** 簽章驗不過就是驗不過——舊版之所以是個大洞，
    正是因為它把「查得到這個名字」當成驗證通過。
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None

    username = payload.get("sub")
    return username if isinstance(username, str) and username else None
