import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { updateMusicFilename } from "../../redux/actions.js";
import { API_ENDPOINTS } from "../../config/api.js";

/**
 * 音樂選擇器：從後端抓這個使用者的音檔清單，切換時更新 Redux 的 music_filename。
 *
 * 完全自持——清單、抓取狀態都在自己身上，對外只有一個 `onTrackChange`，
 * 讓外層在換歌時停止播放（waveform 需要重新載入音檔）。
 */
function MusicSelector({ onTrackChange }) {
  const dispatch = useDispatch();
  const userName = useSelector((state) => state.profiles.user);
  const musicFilename = useSelector(
    (state) => state.profiles.data?.music_filename,
  );

  const [musicList, setMusicList] = useState([]);

  useEffect(() => {
    const fetchMusicList = async () => {
      if (!userName) return;
      try {
        const response = await fetch(
          `${API_ENDPOINTS.BASE}/get_music_list/${userName}`,
        );
        const data = await response.json();
        if (data && data.music_list) {
          setMusicList(data.music_list);
        }
      } catch (error) {
        console.error("抓取音樂清單失敗:", error);
      }
    };

    fetchMusicList();
  }, [userName]);

  const handleMusicChange = (e) => {
    dispatch(updateMusicFilename(e.target.value));
    onTrackChange?.();
  };

  return (
    <div
      className="current-track-display"
      style={{ marginRight: "10px", display: "flex", alignItems: "center" }}
    >
      <div className="dropdown">
        <select
          className="dropdown-select"
          value={musicFilename}
          onChange={handleMusicChange}
          style={{
            minWidth: "150px",
            backgroundColor: "#2c3e50",
            color: "white",
            border: "1px solid #34495e",
            borderRadius: "4px",
            padding: "5px",
          }}
        >
          {/* 如果目前的音樂不在清單中，顯示一個預設選項 */}
          {!musicList.includes(musicFilename) && (
            <option value={musicFilename}>{musicFilename} (目前)</option>
          )}

          {musicList.map((filename, index) => (
            <option key={index} value={filename}>
              🎵 {filename}
            </option>
          ))}
        </select>
        <span className="tooltip">切換音樂</span>
      </div>
    </div>
  );
}

export default MusicSelector;
