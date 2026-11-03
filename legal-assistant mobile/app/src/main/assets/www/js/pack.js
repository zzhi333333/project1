/* =========================================================
 * pack.js —— 零依赖 zip 写入器（store 不压缩模式）
 * 用途：维权材料包（意见书 .doc + 清单 .txt 打包为一个 zip 下载）
 * 纯前端生成，本机完成，不上传。文件名/内容均为 UTF-8。
 * ========================================================= */
window.PACK = (function () {
  /* CRC-32（IEEE 802.3），查表法 */
  var T = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function strBytes(s) {
    var out = [];
    var u = unescape(encodeURIComponent(s));   /* UTF-8 字节串 */
    for (var i = 0; i < u.length; i++) out.push(u.charCodeAt(i) & 0xFF);
    return out;
  }
  function u16(v) { return [v & 0xFF, (v >> 8) & 0xFF]; }
  function u32(v) { return [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF]; }
  /* DOS 时间（2 秒精度） */
  function dosTime(d) {
    return { time: u16((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)),
             date: u16(((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) };
  }

  /* files: [{name, content(字符串)}] → Blob(zip) */
  function build(files) {
    var d = new Date();
    var tt = dosTime(d);
    var localParts = [], centralParts = [], offset = 0;
    files.forEach(function (f) {
      var nameB = strBytes(f.name);
      var dataB = strBytes(String(f.content));
      var crc = crc32(dataB);
      var local = [].concat(
        u32(0x04034B50), u16(20), u16(0x0800),          /* 签名 / 版本 / UTF-8 标志 */
        u16(0),                                          /* store 无压缩 */
        tt.time, tt.date,
        u32(crc), u32(dataB.length), u32(dataB.length),
        u16(nameB.length), u16(0),
        nameB, dataB
      );
      localParts.push(local);
      centralParts.push([].concat(
        u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0),
        tt.time, tt.date,
        u32(crc), u32(dataB.length), u32(dataB.length),
        u16(nameB.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset),
        nameB
      ));
      offset += local.length;
    });
    var centralSize = centralParts.reduce(function (s, p) { return s + p.length; }, 0);
    var eocd = [].concat(
      u32(0x06054B50), u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(centralSize), u32(offset), u16(0)
    );
    var all = [].concat.apply([], localParts.concat(centralParts, [eocd]));
    return new Blob([new Uint8Array(all)], { type: "application/zip" });
  }

  function download(fname, files) {
    try {
      var blob = build(files);
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
      return true;
    } catch (e) { return false; }
  }

  return { build: build, download: download };
})();
