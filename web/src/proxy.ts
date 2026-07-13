import { NextRequest, NextResponse } from "next/server";

// /crash 配下のページと、その静的JSON(/data/crash/配下)にBasic認証をかける。
// 判断ログ: このNext.jsバージョン(16.2.9)ではmiddleware.ts/middleware()は非推奨で
// proxy.ts/proxy()に名称変更されている(node_modules/next/dist/docs/.../proxy.md、
// および`npm run build`実行時に実際に非推奨警告が出ることで確認済み)。
// 新規追加のためmiddleware.tsではなくproxy.tsとして実装する。
// 判断ログ: atob()でbase64をデコードする(Node.js Runtime/Edge Runtimeどちらでも動く
// ポータブルな書き方。v16のProxyはデフォルトNode.js Runtimeだが、将来Edge化されても
// 動作を変えなくて済むようこちらを採用)。
// 判断ログ: CRASH_AUTH_USER/PASS が未設定の場合は「誤って無認証公開する」事故を
// 避けるため常に401を返す(フェイルクローズ)。仕様書の「/crash配下のみ他者から
// 見えなくする」という強い要件に合わせた。

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="crash"' },
  });
}

export function proxy(request: NextRequest) {
  const user = process.env.CRASH_AUTH_USER;
  const pass = process.env.CRASH_AUTH_PASS;
  if (!user || !pass) {
    return unauthorized();
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Basic ")) {
    const encoded = authHeader.slice("Basic ".length);
    try {
      const decoded = atob(encoded);
      const sep = decoded.indexOf(":");
      const suppliedUser = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const suppliedPass = sep >= 0 ? decoded.slice(sep + 1) : "";
      if (suppliedUser === user && suppliedPass === pass) {
        return NextResponse.next();
      }
    } catch {
      // base64デコード失敗は不正リクエストとして401扱いにフォールスルー
    }
  }
  return unauthorized();
}

export const config = {
  matcher: ["/crash", "/crash/:path*", "/data/crash/:path*"],
};
