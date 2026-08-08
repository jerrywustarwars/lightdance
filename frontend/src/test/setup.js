import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * 元件測試的共用環境設定。
 *
 * 編輯器會用到幾個 jsdom 沒有實作的瀏覽器 API（Web Audio、ResizeObserver、
 * matchMedia 等）。這裡補上最小的假實作——目的只是讓元件掛得起來，
 * 不是模擬真實行為；波形/播放的正確性不在冒煙測試的範圍內。
 */

afterEach(() => {
  cleanup();
});

// Web Audio：waveform.jsx 會建立 AudioContext
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.sampleRate = 44100;
    this.state = "running";
  }
  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 0, length: 0, sampleRate: 44100 });
  }
  close() {
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
}

globalThis.AudioContext = FakeAudioContext;
globalThis.webkitAudioContext = FakeAudioContext;

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (!globalThis.matchMedia) {
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

// jsdom 沒有 canvas 2D context，波形繪製會用到
if (!HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = () => null;
}

// 編輯器有些流程會呼叫 alert / prompt
globalThis.alert = vi.fn();
globalThis.prompt = vi.fn(() => null);

// fetch：音樂清單等 API 呼叫，測試不需要真的打網路
if (!globalThis.fetch) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ list: [], music_files: [] }),
    }),
  );
}
