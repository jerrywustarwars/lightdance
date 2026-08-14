import { anchorFor, positionAt } from "./clock.js";
import { fadeEnvelope, scheduleFrom, totalDuration } from "./schedule.js";

/**
 * 播放引擎 —— 所有 Web Audio 的狀態都住在這裡。
 *
 * **刻意不是 hook**，也完全不認得 React：這樣才能用假的 AudioContext 在 jsdom
 * 裡測排程。排程錯誤正是那種「聽起來怪怪的但看不出來」的問題，不測不行。
 *
 * ## 它取代掉什麼
 *
 * 舊版的播放狀態切成三份：`sourceNode` 在 `audioplayer` 的 useState、
 * `startTime` 在 `waveform` 的 useState、真正的時鐘在 `AudioContext`。於是
 * **暫停時有兩個 effect 都會寫 `currentTime`**，後者蓋掉前者——而 seek 修正
 * 之所以有效，靠的是它宣告在後面。誰調一下 effect 的順序，播放中點刻度尺就
 * 又會跳回舊位置，而且不會有任何錯誤。
 *
 * 收進來之後「現在播到哪」只有一個答案：`positionMs()`。
 *
 * ## 為什麼一次把所有 clip 排好
 *
 * 見 `schedule.js`。簡單說：等 `onended` 再啟動下一首一定會有縫，而
 * `start(when, ...)` 的排程在音訊執行緒上，JS 卡住也不影響接縫。
 *
 * 代價是**變速與 seek 都必須重排**——已經排好的 `when` 是用舊速率算的。
 * 這是刻意的取捨：重排是一次 O(clip 數) 的操作（5–6 個），而接縫的品質是
 * 每次播放都聽得到的。
 *
 * ## 生命週期
 *
 * `AudioContext` **第一次播放才建立**。舊版在元件掛載時就 `new` 出來，那時
 * 還沒有任何使用者手勢，Chrome 給的是 `suspended` 的 context——現在能動是
 * 撞運氣，換個瀏覽器或改一下掛載時機就會變成「按播放沒聲音」。
 */

/** 解碼結果的快取（同一個 URL 只下載＋解碼一次） */
const createCache = () => {
  const buffers = new Map(); // url → AudioBuffer
  const inflight = new Map(); // url → Promise（避免同一個 URL 併發解碼兩次）
  return { buffers, inflight };
};

export function createAudioEngine({
  createContext = () => new (window.AudioContext || window.webkitAudioContext)(),
  fetchAudio = (url) => fetch(url).then((res) => res.arrayBuffer()),
} = {}) {
  let context = null;
  let master = null;
  const cache = createCache();

  let clips = [];
  let playing = [];   // [{source, gain}]，正在響的東西
  let isPlaying = false;
  let rate = 1;
  let volume = 1;
  let anchor = 0;     // 見 clock.js 的慣例
  let pausedAt = 0;   // 暫停時停在哪（ms）
  let onEnded = null;

  /** 真正要出聲的時候才建立 context —— 那時一定有使用者手勢 */
  const ensureContext = async () => {
    if (!context) {
      context = createContext();
      master = context.createGain();
      master.gain.value = volume;
      master.connect(context.destination);
    }
    // 分頁切走再切回來、或自動播放政策擋下來時，context 會是 suspended
    if (context.state === "suspended") await context.resume();
    return context;
  };

  const load = async (url) => {
    if (cache.buffers.has(url)) return cache.buffers.get(url);
    if (cache.inflight.has(url)) return cache.inflight.get(url);

    const task = (async () => {
      const ctx = await ensureContext();
      const data = await fetchAudio(url);
      const buffer = await ctx.decodeAudioData(data);
      cache.buffers.set(url, buffer);
      cache.inflight.delete(url);
      return buffer;
    })();

    cache.inflight.set(url, task);
    return task;
  };

  /** 停掉所有正在響的東西。`silent` 時不要讓 onended 冒出去 */
  const stopAll = ({ silent = true } = {}) => {
    for (const { source, gain } of playing) {
      if (silent) source.onended = null;
      try {
        source.stop();
      } catch {
        // 還沒 start 過的 source 會丟，忽略
      }
      source.disconnect();
      gain.disconnect();
    }
    playing = [];
  };

  /**
   * 把 `fromMs` 之後的東西全部排好。
   *
   * 排程與音量包絡都由純函式算（`schedule.js`），這裡只負責建立節點、
   * 接線、把算好的數字餵進去。
   */
  const schedule = async (fromMs) => {
    const ctx = await ensureContext();
    const plan = scheduleFrom(clips, {
      fromMs,
      rate,
      contextTime: ctx.currentTime,
    });

    // 需要的音檔先全部備妥再開始接線，否則第一個 clip 已經在響、
    // 第二個還在解碼，接縫就開天窗了
    await Promise.all([...new Set(plan.map((p) => p.clip.sourceFile))].map(load));

    for (const { clip, when, offset, duration } of plan) {
      const buffer = cache.buffers.get(clip.sourceFile);
      if (!buffer) continue;

      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.connect(gain).connect(master);

      const points = fadeEnvelope(clip, { fromMs, rate, contextTime: ctx.currentTime });
      if (points.length === 1) {
        gain.gain.value = points[0].value;
      } else {
        gain.gain.setValueAtTime(points[0].value, points[0].when);
        for (const point of points.slice(1)) {
          gain.gain.linearRampToValueAtTime(point.value, point.when);
        }
      }

      source.start(when, offset, duration);
      playing.push({ source, gain });
    }

    /*
     * 整場結束的通知只掛在**最後一個** clip 上。掛在每一個上面的話，
     * 每首歌播完都會通知一次「播放結束」，播放鍵會在接縫處自己跳掉。
     */
    const last = playing[playing.length - 1];
    if (last) {
      last.source.onended = () => {
        if (!isPlaying) return; // 是我們自己停的，不是自然播完
        isPlaying = false;
        pausedAt = totalDuration(clips);
        onEnded?.();
      };
    }
  };

  return {
    /** 換掉整條音訊時間軸。播放中換會停下來——內容都變了，位置沒有意義 */
    setClips(next) {
      clips = Array.isArray(next) ? next : [];
      if (isPlaying) {
        stopAll();
        isPlaying = false;
      }
      pausedAt = Math.min(pausedAt, totalDuration(clips));
    },

    getClips: () => clips,
    durationMs: () => totalDuration(clips),

    /** 預先把音檔抓下來解碼，之後按播放就不用等 */
    prepare: () =>
      Promise.all([...new Set(clips.map((clip) => clip.sourceFile))].map(load)),

    async play(fromMs = pausedAt) {
      if (isPlaying) return;
      const ctx = await ensureContext();
      anchor = anchorFor({ contextTime: ctx.currentTime, positionMs: fromMs, rate });
      isPlaying = true;
      pausedAt = fromMs;
      await schedule(fromMs);
    },

    pause() {
      if (!isPlaying) return pausedAt;
      pausedAt = this.positionMs();
      stopAll();
      isPlaying = false;
      return pausedAt;
    },

    /** 跳到某個時間。播放中會重排（已排好的 when 是用舊起點算的） */
    async seek(ms) {
      const target = Math.max(0, ms);
      pausedAt = target;
      if (!isPlaying) return target;

      stopAll();
      const ctx = await ensureContext();
      anchor = anchorFor({ contextTime: ctx.currentTime, positionMs: target, rate });
      await schedule(target);
      return target;
    },

    /**
     * 變速。播放中要重排——已排好的 `when` 是用舊速率算的，不重排的話
     * 後面幾首歌會在錯的時間點進來。
     */
    async setRate(next) {
      const value = Number.isFinite(next) && next > 0 ? next : 1;
      if (value === rate) return;

      if (!isPlaying) {
        rate = value;
        return;
      }

      const at = this.positionMs();
      stopAll();
      rate = value;
      const ctx = await ensureContext();
      anchor = anchorFor({ contextTime: ctx.currentTime, positionMs: at, rate });
      await schedule(at);
    },

    setVolume(next) {
      volume = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 1;
      if (master) master.gain.value = volume;
    },

    /** 現在播到第幾毫秒 —— **全站唯一的答案** */
    positionMs() {
      if (!isPlaying || !context) return pausedAt;
      const position = positionAt({
        contextTime: context.currentTime,
        anchor,
        rate,
      });
      return Math.max(0, Math.min(position, totalDuration(clips)));
    },

    isPlaying: () => isPlaying,

    /** 整場自然播完時通知（不是暫停、不是 seek） */
    onEnded(handler) {
      onEnded = handler;
    },

    /** 元件卸載時呼叫，否則 AudioContext 會累積（瀏覽器對數量有上限） */
    dispose() {
      stopAll();
      isPlaying = false;
      master?.disconnect();
      context?.close?.();
      context = null;
      master = null;
      cache.buffers.clear();
      cache.inflight.clear();
    },
  };
}
