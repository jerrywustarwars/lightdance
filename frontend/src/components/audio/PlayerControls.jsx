import { useDispatch, useSelector } from "react-redux";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlay,
  faPause,
  faVolumeHigh,
} from "@fortawesome/free-solid-svg-icons";

import { updatePlaybackRate } from "../../redux/actions.js";

/** 縮放上限（拖曳/波形寬度都以此為界） */
export const MAX_ZOOM = 100;

/** 縮放的一格：按 +/- 時對齊到 0.05 的倍數 */
const ZOOM_STEP = 0.05;

const formatTime = (timeInMilliseconds) => {
  const minutes = Math.floor(timeInMilliseconds / 60000);
  const seconds = Math.floor((timeInMilliseconds % 60000) / 1000);
  const milliseconds = Math.floor(timeInMilliseconds % 1000);

  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}:${
    milliseconds < 100 ? "0" : ""
  }${milliseconds < 10 ? "0" : ""}${milliseconds}`;
};

/**
 * 播放控制列：速度、播放/暫停、時間顯示、縮放、音量。
 *
 * 播放速度自己走 Redux；`isPlaying` / `zoomLevel` / `volume` 是外殼持有的狀態
 * （waveform 與 scroll-container 也要用），所以做成受控元件由外層傳入。
 */
function PlayerControls({
  isPlaying,
  setIsPlaying,
  zoomLevel,
  setZoomLevel,
  volume,
  setVolume,
}) {
  const dispatch = useDispatch();
  const playbackRate = useSelector((state) => state.profiles.playbackRate);
  const currentTime = useSelector((state) => state.profiles.currentTime);
  const duration = useSelector((state) => state.profiles.duration);

  const handleSpeedChange = (speed) => {
    dispatch(updatePlaybackRate(parseFloat(speed)));
  };

  const handleZoom = (event) => {
    setZoomLevel(Math.floor(event.target.value));
  };

  const handleMinusZoom = () => {
    setZoomLevel((prevZoom) =>
      Math.max(
        (Math.round((prevZoom - ZOOM_STEP) / ZOOM_STEP) * ZOOM_STEP).toFixed(2),
        1,
      ),
    );
  };

  const handlePlusZoom = () => {
    setZoomLevel((prevZoom) =>
      Math.min(
        (Math.round((prevZoom + ZOOM_STEP) / ZOOM_STEP) * ZOOM_STEP).toFixed(2),
        MAX_ZOOM,
      ),
    );
  };

  const handleVolumeChange = (event) => {
    // 調音量會重建 audio graph，所以先停止播放
    if (isPlaying) setIsPlaying(false);
    setVolume(event.target.value);
  };

  return (
    <>
      {/* 播放速度 */}
      <div className="dropdown">
        <select
          id="speed-select"
          className="dropdown-select"
          value={playbackRate || 1}
          onChange={(e) => handleSpeedChange(e.target.value)}
          style={{ marginLeft: "10px" }}
        >
          <option value="0.5">0.5x</option>
          <option value="0.75">0.75x</option>
          <option value="1">1x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2x</option>
        </select>
        <span className="tooltip">播放速度</span>
      </div>

      <div className="play-control">
        <button
          className="play-button"
          onClick={() => setIsPlaying((playing) => !playing)}
        >
          {isPlaying ? (
            <>
              <FontAwesomeIcon icon={faPause} size="lg" />
              <span className="tooltip">暫停<kbd>Space</kbd></span>
            </>
          ) : (
            <>
              <FontAwesomeIcon icon={faPlay} size="lg" />
              <span className="tooltip">播放<kbd>Space</kbd></span>
            </>
          )}
        </button>
        <span className="current-time-box">{formatTime(currentTime)}</span>
        <span className="time-separator">/</span>
        <span className="duration-box">{formatTime(duration)}</span>
      </div>

      <div className="zoom-controls">
        <button onClick={handleMinusZoom} disabled={zoomLevel < 1}>
          -
        </button>
        <input
          type="range"
          min="1"
          max={MAX_ZOOM}
          step="0.01"
          value={zoomLevel}
          onChange={handleZoom}
          className="zoom-slider"
        />
        <button onClick={handlePlusZoom} disabled={zoomLevel > MAX_ZOOM}>
          +
        </button>
      </div>

      <div className="volume-control">
        <div className="volume-icon" style={{ color: "rgb(150, 146, 146)" }}>
          <FontAwesomeIcon icon={faVolumeHigh} size="lg" />
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          className="volume-slider"
          onChange={handleVolumeChange}
          style={{ width: "100px" }}
        />
      </div>
    </>
  );
}

export default PlayerControls;
