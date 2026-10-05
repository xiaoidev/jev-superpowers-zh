// 上游 zh 测试依赖 npm 包 ws（EventEmitter 风格：.on('open'|'message'|...)、
// .send()/.close()）。Node 21+ 起全局内置 WebSocket（undici），Node 24 已验证
// 支持 new WebSocket(url, { headers: { Cookie, Origin } })，但它是 Web 平台
// 事件模型（addEventListener、MessageEvent）。本适配层把全局 WebSocket 包成
// 测试所需的 ws 客户端 API，保持零第三方依赖。
'use strict';

const { EventEmitter } = require('node:events');

class WSLike extends EventEmitter {
  constructor(url, opts) {
    super();
    const options = opts && opts.headers ? { headers: opts.headers } : undefined;
    const ws = new globalThis.WebSocket(url, options);
    ws.binaryType = 'arraybuffer';
    this._ws = ws;

    ws.addEventListener('open', () => this.emit('open'));
    ws.addEventListener('message', (ev) => this.emit('message', ev.data));
    ws.addEventListener('close', (ev) => {
      this.emit('close', ev.code, ev.reason, ev.wasClean);
    });
    ws.addEventListener('error', (ev) => {
      // undici 的 error 事件在握手失败时不带 message；保持与 ws 一致：
      // error 后通常还会跟 close，监听方各自幂等处理。
      this.emit('error', ev.error || ev);
    });
  }

  get readyState() {
    return this._ws.readyState;
  }

  get protocol() {
    return this._ws.protocol;
  }

  send(data) {
    return this._ws.send(data);
  }

  close(code, reason) {
    try {
      return this._ws.close(code, reason);
    } catch {
      return undefined;
    }
  }

  // ws 的 terminate()：不发关闭帧直接断。undici 客户端无等价 API，降级为 close()。
  terminate() {
    try {
      return this._ws.close();
    } catch {
      return undefined;
    }
  }
}

// ws 包在构造函数上暴露 readyState 常量（CONNECTING/OPEN/CLOSING/CLOSED）。
WSLike.CONNECTING = 0;
WSLike.OPEN = 1;
WSLike.CLOSING = 2;
WSLike.CLOSED = 3;

module.exports = WSLike;
