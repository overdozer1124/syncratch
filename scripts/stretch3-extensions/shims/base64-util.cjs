/** Browser-native base64 helpers (replaces scratch-vm util/base64-util). */
class Base64Util {
  static uint8ArrayToBase64(array) {
    let str = "";
    for (let i = 0; i < array.length; i++) {
      str += String.fromCharCode(array[i]);
    }
    return btoa(str);
  }

  static base64ToUint8Array(base64) {
    const str = atob(base64);
    const array = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      array[i] = str.charCodeAt(i);
    }
    return array;
  }

  static arrayBufferToBase64(buffer) {
    return Base64Util.uint8ArrayToBase64(new Uint8Array(buffer));
  }
}

module.exports = Base64Util;
