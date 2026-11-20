/**
 * 翻訳 API のルート定義です。
 *
 * すべてのエンドポイントに公式 CE の認証・認可・レート制限ミドルウェアを
 * そのまま適用しています。ブラウザーが呼び出すのは Overleaf の同一オリジン API
 * だけであり、Overleaf がログイン確認とプロジェクト権限の確認をした後に
 * 内部ネットワークの翻訳サービスへ中継します（LLM の API キーは中継先のみが知ります）。
 */

import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import LocalLlmTranslationController from './LocalLlmTranslationController.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'

// 翻訳は LLM を消費する処理なので、ユーザー行動全体と翻訳単位の両方で制限します。
const translateLimiter = new RateLimiter('local-llm-translation', {
  points: 40,
  duration: 10 * 60,
})

export default {
  apply(webRouter) {
    // 利用可能な LLM モデル一覧（翻訳パネルの選択欄用）。ログイン必須。
    webRouter.get(
      '/local-llm/models',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(translateLimiter, { ipOnly: true }),
      LocalLlmTranslationController.getModels
    )

    // LLM 接続先設定・翻訳エンドポイント CRUD の route 群は廃止済み（Phase 2）。
    // 接続先の選び場所は LLM 設定画面（/user/llm-settings の翻訳専用欄 +
    // /user/llm-providers）へ集約し、翻訳パネルには接続系 UI を置きません。
    // 翻訳サービス側のエンドポイント/.env は「標準設定に従う」場合の
    // フォールバックとしてサーバー内部に残ります。

    // プロジェクトの翻訳設定（用語集・モデル・文体メモ）の読み込み。
    // プロジェクトの読み取り権限が必要です。
    webRouter.get(
      '/project/:Project_id/local-llm/settings',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      LocalLlmTranslationController.getSettings
    )

    // 翻訳設定の保存。プロジェクト本文の書き込み権限が必要です。
    webRouter.put(
      '/project/:Project_id/local-llm/settings',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      LocalLlmTranslationController.putSettings
    )

    // 翻訳本体の開始（SSE ストリーム）。プロジェクトの読み取り権限があれば開始でき、
    // 結果の保存は別の書き込み権限チェックを要します。
    webRouter.post(
      '/project/:Project_id/local-llm/translate',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(translateLimiter, {
        params: ['Project_id'],
      }),
      LocalLlmTranslationController.translate
    )

    // 英語版 .en.tex 文書の作成・上書き保存。書き込み権限が必要です。
    webRouter.put(
      '/project/:Project_id/local-llm/english-document',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      LocalLlmTranslationController.saveEnglishDocument
    )

    // （旧 AI アシスタントのプロキシ route 群は廃止済み: チャットは
    //  llm モジュールの /project/:id/llm/chat に統合されました）

    // --- 日本語/英語横並び表示パネルのファイル読み書き ------------------------
    // 読み取りは docstore 最新版、保存は通常の編集操作と同じ upsert 経路です。
    webRouter.get(
      '/project/:Project_id/local-llm/doc-content',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      LocalLlmTranslationController.getDocContent
    )
    webRouter.put(
      '/project/:Project_id/local-llm/doc-content',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      LocalLlmTranslationController.saveDocContent
    )
  },
}
