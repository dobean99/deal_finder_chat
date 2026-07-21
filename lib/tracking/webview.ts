// UA-based in-app webview detection (F10). Covers the dominant VN social
// in-app browsers: Facebook, Instagram, TikTok, Zalo, Line, WeChat, plus the
// generic Android WebView marker "wv)".

const WEBVIEW_UA_PATTERN =
  /\b(FBAN|FBAV|FB_IAB|Instagram|TikTok|BytedanceWebview|Zalo|Line\/|MicroMessenger|GSA\/|wv\))/i;

export function isWebviewUa(ua: string): boolean {
  return WEBVIEW_UA_PATTERN.test(ua);
}
