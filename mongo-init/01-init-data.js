// Authenticate as the root user in the admin database
db = db.getSiblingDB('admin');
db.auth('root', 'nycuee');

// Switch to the application's database
db = db.getSiblingDB('test');

// Create a dedicated user for the application with read/write permissions
db.createUser({
  user: 'testuser',
  pwd: 'testpassword',
  roles: [
    { role: 'readWrite', db: 'test' }
  ]
});

// Create initial collections and data
db.users.insertOne({
    "username": "testuser",
    "password": "testpassword", // This might be redundant if auth is handled by the new user
    "disabled": false
});

db.createCollection('color');
db.createCollection('raw_json');

/*
 * 索引。
 *
 * 這個資料庫原本一個索引都沒有，於是每一次「載入最新版本」都是
 * 「掃過這個使用者的所有光表、全部載進記憶體、排序、取第一筆」。一份密集光表
 * 的 players 實測 43KB，存了幾十版之後每次開 Dashboard 都要搬好幾 MB。
 *
 * (user, update_time) 這一組同時服務四種查詢：指定版本、LATEST、某使用者的
 * 版本清單、上傳時的計數。
 *
 * unique 是為了擋掉「同一個時間戳兩份文件」——那會讓 find_one 回哪一份變成
 * 沒有定義的行為。後端啟動時也會跑一次 ensure_indexes（backend/storage.py），
 * 兩邊是同一份定義；這裡寫著是為了讓全新部署一開始就有，不必等服務起來。
 */
db.color.createIndex({ user: 1, update_time: -1 }, { unique: true });
db.raw_json.createIndex({ user: 1, update_time: -1 }, { unique: true });

// 帳號名稱是登入的鍵。沒有唯一索引的話資料庫允許兩個同名帳號存在，
// 而 find_one 只會回其中一個——密碼對不上的那位使用者會登不進來
db.users.createIndex({ username: 1 }, { unique: true });