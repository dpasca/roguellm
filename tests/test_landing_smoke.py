import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from db import DatabaseManager
from game_state_manager import WORLD_TRANSLATION_CACHE_VERSION
from tools.ensure_dev_worlds import DEV_PIEDONE_THEME, ensure_dev_worlds


REPO_ROOT = Path(__file__).resolve().parents[1]
TEST_FIREBASE_ENV = {
    "ANALYTICS_ENABLED": "1",
    "FIREBASE_API_KEY": "test-api-key",
    "FIREBASE_AUTH_DOMAIN": "roguellm.test.firebaseapp.com",
    "FIREBASE_PROJECT_ID": "roguellm-test",
    "FIREBASE_STORAGE_BUCKET": "roguellm-test.firebasestorage.app",
    "FIREBASE_MESSAGING_SENDER_ID": "123456789",
    "FIREBASE_APP_ID": "1:123456789:web:test",
    "FIREBASE_MEASUREMENT_ID": "G-TEST123",
}


async def passthrough_prerender(request, html_content):
    return html_content


class LandingSmokeTests(unittest.TestCase):
    def make_db(self, directory):
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            manager = DatabaseManager()
        manager.db_path = os.path.join(directory, "landing_smoke.db")
        manager.init_db()
        return manager

    def test_world_picker_landing_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            seeded_worlds = ensure_dev_worlds(manager)
            piedone = next(world for world in seeded_worlds if world["key"] == "piedone")
            piedone_translation = manager.get_generator_translation(
                piedone["id"],
                "en",
                WORLD_TRANSLATION_CACHE_VERSION,
            )

            self.assertIn("en", piedone["cached_translations"])
            self.assertIsNotNone(piedone_translation)
            self.assertEqual(piedone_translation["player_defs"][0]["name"], "Piedone")
            self.assertEqual(piedone_translation["item_defs"][0]["id"], "espresso")
            self.assertEqual(piedone_translation["enemy_defs"][0]["enemy_id"], "street_punk")

            with patch.dict(os.environ, {"ENABLE_WORLD_LIBRARY": "1"}), \
                    patch("main.db", manager), \
                    patch("main.get_prerendered_content", passthrough_prerender):
                main.game_session_manager.sessions.clear()
                with TestClient(main.app) as client:
                    landing = client.get("/?lang=en")
                    self.assertEqual(landing.status_code, 200)

                    html = landing.text
                    landing_js = (REPO_ROOT / "static/js/landing.js").read_text(encoding="utf-8")
                    credit_store_js = (
                        REPO_ROOT / "static/js/creditStore.js"
                    ).read_text(encoding="utf-8")
                    landing_css = (
                        REPO_ROOT / "static/css/landing.css"
                    ).read_text(encoding="utf-8")
                    lobby_css = (
                        REPO_ROOT / "static/css/lobby.css"
                    ).read_text(encoding="utf-8")
                    capacitor_config = json.loads(
                        (REPO_ROOT / "capacitor.config.json").read_text(encoding="utf-8")
                    )
                    english_translations = (
                        REPO_ROOT / "static/translations/en.json"
                    ).read_text(encoding="utf-8")
                    # The lobby is three regions: a thin bar, one prompt box,
                    # and a gallery. Everything else lives behind the account
                    # button or a World card.
                    self.assertIn('static/css/lobby.css', html)
                    self.assertIn('<body class="landing-page">', html)
                    self.assertIn('class="lobby-bar"', html)
                    self.assertIn('class="lobby-account"', html)
                    self.assertIn('class="forge-box"', html)
                    self.assertIn('class="forge-input"', html)
                    self.assertIn('@click="forgeWorld"', html)
                    self.assertIn('class="world-grid"', html)
                    self.assertIn('class="world-card"', html)
                    self.assertIn('class="card-art"', html)
                    self.assertIn('world.cover_url', html)
                    self.assertIn('class="card-art-blank"', html)
                    # The cover is decorative: the title is right below it in
                    # the same card, so alt text here reads the title twice.
                    self.assertIn('alt=""', html)
                    self.assertNotIn(':alt="world.title"', html)
                    self.assertIn('@click="playWorld(world)"', html)

                    # The old lobby's regions are gone, including the fake map
                    # that stood in for a screenshot.
                    self.assertNotIn('class="landing-mode-tabs"', html)
                    self.assertNotIn('class="game-preview"', html)
                    self.assertNotIn('class="preview-map"', html)
                    self.assertNotIn('class="landing-panel world-panel"', html)
                    self.assertNotIn('class="landing-panel create-panel"', html)

                    # Dialogs are retained and still reachable.
                    self.assertIn('static/css/landing.css', html)
                    self.assertIn('class="auth-strip"', html)
                    self.assertIn('class="auth-copy"', html)
                    self.assertIn('class="auth-panel-header"', html)
                    self.assertIn('class="dashboard-avatar"', html)
                    self.assertIn('class="dashboard-stats"', html)
                    self.assertIn('class="account-backdrop"', html)
                    self.assertIn('class="public-review-modal"', html)
                    self.assertIn('@submit.prevent="submitAuth"', html)
                    self.assertIn('@click="logout"', html)
                    self.assertIn('role="alert"', html)
                    self.assertIn('v-text="errorMessage"', html)
                    self.assertIn('class="world-code-trigger"', html)
                    self.assertIn('class="lobby-sheet-panel world-code-panel"', html)
                    self.assertIn('class="lobby-sheet-panel world-menu-panel"', html)
                    self.assertIn('class="creator-milestone-card"', html)
                    self.assertIn('class="credit-store-modal"', html)
                    self.assertIn('class="credit-store-pack-grid"', html)
                    self.assertIn('aria-labelledby="credit-store-title"', html)
                    self.assertIn('@click="openCreditStore"', html)
                    self.assertIn('@click="purchaseCreditPack(pack)"', html)
                    self.assertIn(DEV_PIEDONE_THEME, landing_js)
                    self.assertIn("submitAuth", landing_js)
                    self.assertIn("responseErrorMessage", landing_js)
                    self.assertIn("translationForKey", landing_js)
                    self.assertIn("refreshAuthWorldState", landing_js)
                    self.assertIn("playWorld", landing_js)
                    self.assertIn("forgeWorld", landing_js)
                    self.assertIn('@click="quickStartPiedone()"', html)
                    self.assertIn("promptSignInForSave", landing_js)
                    self.assertIn("signInWithProvider", landing_js)
                    self.assertIn("prepareAccountDeletion", landing_js)
                    self.assertIn("toggleAccountPanel", landing_js)
                    self.assertIn("closeAccountPanel", landing_js)
                    self.assertIn("emptyWorldsTitle", landing_js)
                    self.assertIn("myWorldsEmptyBody", landing_js)
                    self.assertIn("/api/login", landing_js)
                    self.assertIn("/api/signup", landing_js)
                    self.assertIn("/api/logout", landing_js)
                    self.assertIn("/api/auth/firebase", landing_js)
                    self.assertIn("/api/account", landing_js)
                    self.assertIn("/api/my/worlds", landing_js)
                    self.assertIn("/api/my/stats", landing_js)
                    self.assertIn("dashboardStats", landing_js)
                    self.assertIn("activeCreatorMilestoneProgress", landing_js)
                    self.assertIn("creator_reward_credits", landing_js)
                    self.assertIn("openCreditStore", landing_js)
                    self.assertIn("purchaseCreditPack", landing_js)
                    self.assertIn("result.verified !== true", landing_js)
                    self.assertIn("this.creditBalance <= balanceBeforePurchase", landing_js)
                    self.assertIn("RogueLLMCreditPurchaseProvider", credit_store_js)
                    self.assertIn("credits_40", credit_store_js)
                    self.assertIn("credits_120", credit_store_js)
                    self.assertIn("credits_300", credit_store_js)
                    self.assertNotIn("fetch(", credit_store_js)
                    self.assertIn("copyWorldLink", landing_js)
                    self.assertIn("openWorldCodePanel", landing_js)
                    self.assertIn("openWorldMenu", landing_js)
                    self.assertIn("worldVisibilityLabel", landing_js)
                    self.assertIn("publicReviewDialog", landing_js)
                    self.assertIn("finishPublicReviewDialog", landing_js)
                    self.assertIn("getDebugSeedFromUrl", landing_js)
                    self.assertIn("debug_seed", landing_js)
                    self.assertIn("requiresAuthForSelectedCreation", landing_js)
                    self.assertIn("launchButtonLabel", landing_js)
                    self.assertNotIn("showEmptySignupPrompt", landing_js)
                    self.assertNotIn("{{ t('signupToCreate') }}", html)
                    self.assertIn("--safe-area-inset-top", lobby_css)
                    self.assertIn("--safe-area-inset-bottom", lobby_css)
                    self.assertEqual(
                        capacitor_config["plugins"]["SystemBars"]["insetsHandling"],
                        "css",
                    )
                    self.assertIn("do_web_search: true", landing_js)
                    self.assertIn("window.trackAnalyticsEvent('game_started'", landing_js)
                    self.assertNotIn("analytics.logEvent('page_view'", landing_js)
                    self.assertIn("body.landing-page", landing_css)
                    self.assertIn(".preview-map", landing_css)
                    self.assertIn(".public-review-modal", landing_css)
                    self.assertIn(".public-review-close-btn", landing_css)
                    self.assertIn(".tile.hero::after", landing_css)
                    self.assertIn(".dashboard-avatar", landing_css)
                    self.assertIn(".account-trigger", landing_css)
                    self.assertIn(".world-option .world-preview", landing_css)
                    self.assertIn(".world-launch-actions", landing_css)
                    self.assertIn(".lobby-sheet-panel", landing_css)
                    self.assertIn(".creator-milestone-card", landing_css)
                    self.assertIn(".credit-store-modal", landing_css)
                    self.assertIn(".credit-store-pack", landing_css)
                    self.assertIn("grid-template-columns: minmax(360px, 0.95fr) minmax(520px, 1.05fr)", landing_css)
                    self.assertIn("grid-template-columns: minmax(126px, 150px) minmax(128px, 1fr) minmax(128px, 1fr) auto", landing_css)
                    self.assertIn("overflow-y: auto", landing_css)
                    self.assertIn("playWorlds", english_translations)
                    self.assertIn("createWorld", english_translations)
                    self.assertIn("dashboardWelcome", english_translations)
                    self.assertIn("visibilityRequestPublic", english_translations)
                    self.assertIn("visibilityPublicPending", english_translations)
                    self.assertIn("publicReviewTitle", english_translations)
                    self.assertIn("publicReviewRejectedTitle", english_translations)
                    self.assertIn("publicReviewClose", english_translations)
                    self.assertIn("signInToCreate", english_translations)
                    self.assertIn("continueGoogle", english_translations)
                    self.assertIn("continueApple", english_translations)
                    self.assertIn("deleteAccountBody", english_translations)
                    self.assertIn("authRequiredToCreateWorld", english_translations)
                    self.assertIn("creditStoreMobileOnly", english_translations)
                    self.assertIn("creditStoreSecureNote", english_translations)
                    self.assertIn("creatorMilestoneProgress", english_translations)
                    self.assertNotIn('id="fantasy"', html)
                    self.assertNotIn('class="theme-options"', html)
                    self.assertNotIn("doWebSearch", landing_js)
                    self.assertNotIn("improveGameDescription", html)
                    self.assertNotIn('@click="quickStartPiedone"', html.replace('@click="quickStartPiedone()"', ""))
                    self.assertNotIn("selectedWorld()", landing_js)
                    self.assertNotIn(main.ANALYTICS_HEAD_PLACEHOLDER, html)

                    # The card's own menu button must sit inside the card, so
                    # opening details does not also start a run.
                    card = html.index('class="world-card"')
                    card_menu = html.index('class="card-menu"', card)
                    card_close = html.index("</article>", card)
                    self.assertLess(card_menu, card_close)
                    self.assertIn('@click.stop.prevent="openWorldMenu(world.id)"', html)

                    worlds_response = client.get("/api/worlds/recent?limit=12")
                    self.assertEqual(worlds_response.status_code, 200)
                    worlds = worlds_response.json()["worlds"]
                    self.assertTrue(any(world["id"] == piedone["id"] for world in worlds))

                    session_response = client.post("/api/create_game_session", json={
                        "generator_id": piedone["id"],
                        "language": "en",
                        "do_web_search": False,
                    })
                    self.assertEqual(session_response.status_code, 200)
                    session_id = session_response.json()["session_id"]
                    self.assertEqual(
                        main.game_session_manager.sessions[session_id]["language"],
                        "en",
                    )
                    self.assertIsNone(
                        main.game_session_manager.sessions[session_id]["debug_seed"],
                    )

    def test_analytics_is_injected_into_landing_and_game_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_db(directory)
            with patch.dict(os.environ, TEST_FIREBASE_ENV, clear=False), \
                    patch("main.db", manager), \
                    patch("main.get_prerendered_content", passthrough_prerender):
                main.game_session_manager.sessions.clear()
                main.game_session_manager.sessions["analytics-test"] = {}

                with TestClient(main.app) as client:
                    landing_response = client.get("/")
                    game_response = client.get("/game/analytics-test")

            main.game_session_manager.sessions.clear()

        self.assertEqual(landing_response.status_code, 200)
        self.assertEqual(game_response.status_code, 200)
        for html in (landing_response.text, game_response.text):
            self.assertIn("/static/js/firebaseRuntime.js", html)
            self.assertIn('"analyticsEnabled":true', html)
            self.assertIn('"measurementId":"G-TEST123"', html)
            self.assertNotIn(main.ANALYTICS_HEAD_PLACEHOLDER, html)

    def test_game_shell_promotes_home_restart_and_quit(self):
        game_html = (REPO_ROOT / "static/game.html").read_text(encoding="utf-8")
        game_js = (REPO_ROOT / "static/js/createApp.js").read_text(encoding="utf-8")
        menu_css = (REPO_ROOT / "static/css/menu.css").read_text(encoding="utf-8")
        english_translations = (
            REPO_ROOT / "static/translations/en.json"
        ).read_text(encoding="utf-8")

        self.assertIn('class="game-header-actions"', game_html)
        self.assertIn('@click="goHome"', game_html)
        self.assertIn('@click="restartGame"', game_html)
        self.assertIn('@click="quitGame"', game_html)
        self.assertIn('$t(\'menu.home\')', game_html)
        self.assertIn('$t(\'menu.quit\')', game_html)
        self.assertNotIn('@click="shareGame"', game_html)
        self.assertNotIn('@click="newGame(true)"', game_html)

        self.assertIn("goHome()", game_js)
        self.assertIn("quitGame()", game_js)
        self.assertIn("window.open(url, '_blank', 'noopener')", game_js)
        self.assertIn("action: 'quit'", game_js)
        self.assertIn("reward.creator_reward?.reward_granted", game_js)
        self.assertIn("completionReward?.creator_reward?.reward_granted", game_html)
        self.assertIn("runEnd.creatorMilestoneReward", game_html)

        self.assertIn(".game-header-actions", menu_css)
        self.assertIn(".game-header-btn.home-btn", menu_css)
        self.assertIn(".game-header-btn.quit-btn", menu_css)

        self.assertIn('"home": "Home"', english_translations)
        self.assertIn('"creatorMilestoneReward"', english_translations)
        self.assertIn('"quit": "Quit"', english_translations)
        self.assertIn('"quitConfirm"', english_translations)

    def test_debug_seed_is_dev_only(self):
        with patch.dict(os.environ, {"ENABLE_DEBUG_SEED": ""}), \
                patch("main.get_prerendered_content", passthrough_prerender):
            main.game_session_manager.sessions.clear()
            with TestClient(main.app) as client:
                blocked_response = client.post("/api/create_game_session", json={
                    "theme": "fantasy",
                    "language": "en",
                    "debug_seed": 123,
                })

            self.assertEqual(blocked_response.status_code, 403)
            self.assertEqual(main.game_session_manager.sessions, {})

    def test_debug_seed_can_be_enabled_for_test_runs(self):
        with patch.dict(os.environ, {"ENABLE_DEBUG_SEED": "1"}), \
                patch("main.get_prerendered_content", passthrough_prerender):
            main.game_session_manager.sessions.clear()
            with TestClient(main.app) as client:
                response = client.post("/api/create_game_session", json={
                    "theme": "fantasy",
                    "language": "en",
                    "debug_seed": 123,
                })

            self.assertEqual(response.status_code, 200)
            session_id = response.json()["session_id"]
            self.assertEqual(
                main.game_session_manager.sessions[session_id]["debug_seed"],
                123,
            )

    def test_websocket_creation_uses_debug_seed_when_present(self):
        created_with = {}

        class FakeGame:
            state_manager = SimpleNamespace(generator_id=None, error_message=None)

            def add_client(self, websocket):
                pass

            def remove_client(self, websocket):
                pass

            async def handle_message(self, message):
                return {"type": "update"}

        async def fake_create(**kwargs):
            created_with.update(kwargs)
            return FakeGame()

        with patch.dict(os.environ, {
            "ENABLE_DEBUG_SEED": "1",
            "DEFAULT_NEW_WORLD_VISIBILITY": "private",
        }), \
                patch("main.Game.create", side_effect=fake_create), \
                patch("main.get_prerendered_content", passthrough_prerender):
            main.game_session_manager.sessions.clear()
            with TestClient(main.app) as client:
                response = client.post("/api/create_game_session", json={
                    "theme": "fantasy",
                    "language": "en",
                    "debug_seed": 123,
                })
                session_id = response.json()["session_id"]

                with client.websocket_connect(f"/ws/game/{session_id}") as websocket:
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "creating")
                    self.assertEqual(websocket.receive_json()["status"], "ready")
                    self.assertEqual(websocket.receive_json()["type"], "connection_established")

        self.assertEqual(created_with["seed"], 123)
        self.assertTrue(created_with["do_web_search"])
        self.assertEqual(created_with["visibility"], "private")
        self.assertIsNone(created_with["owner_id"])


if __name__ == "__main__":
    unittest.main()
