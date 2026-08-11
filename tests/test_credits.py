import os
import tempfile
import unittest
from unittest.mock import patch

from db import DatabaseManager
from economy import get_creator_milestone_rewards


class CreditAndPopularityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        with patch.dict(os.environ, {
            "DO_STORAGE_SERVER": "",
            "DO_SPACES_ACCESS_KEY": "",
            "DO_SPACES_SECRET_KEY": "",
            "DO_STORAGE_CONTAINER": "",
        }):
            self.database = DatabaseManager()
        self.database.db_path = os.path.join(self.directory.name, "credits.db")
        self.database.init_db()
        self.user = self.database.create_user("player", "Secret123!")

    def tearDown(self):
        self.database.shutdown()
        self.directory.cleanup()

    def make_world(self, title: str, owner_id=None) -> str:
        return self.database.save_generator(
            theme_desc=title,
            theme_desc_better=title,
            language="en",
            player_defs=[{"name": "Hero"}],
            item_defs=[],
            enemy_defs=[],
            celltype_defs={},
            owner_id=owner_id,
            visibility="public",
        )

    def test_grants_are_append_only_and_idempotent(self):
        first = self.database.grant_credits(
            self.user["id"], 30, "welcome_grant", f"welcome:{self.user['id']}"
        )
        second = self.database.grant_credits(
            self.user["id"], 30, "welcome_grant", f"welcome:{self.user['id']}"
        )

        self.assertTrue(first["applied"])
        self.assertFalse(second["applied"])
        self.assertEqual(second["balance"]["total"], 30)
        with self.database.get_connection() as conn:
            count = conn.execute("SELECT COUNT(*) FROM credit_ledger").fetchone()[0]
        self.assertEqual(count, 1)

    def test_spend_uses_promo_before_paid_and_refunds_each_bucket(self):
        self.database.grant_credits(
            self.user["id"], 6, "promo", "grant:promo", bucket="promo"
        )
        self.database.grant_credits(
            self.user["id"], 8, "purchase", "grant:paid", bucket="paid"
        )

        charge = self.database.spend_credits(
            self.user["id"], 10, "world_forge", "forge:one"
        )
        duplicate = self.database.spend_credits(
            self.user["id"], 10, "world_forge", "forge:one"
        )

        self.assertTrue(charge["spent"])
        self.assertEqual(charge["balance"], {"promo": 0, "paid": 4, "total": 4})
        self.assertFalse(duplicate["applied"])
        self.assertEqual(duplicate["balance"]["total"], 4)

        refund = self.database.refund_credit_spend(
            self.user["id"], "forge:one"
        )
        duplicate_refund = self.database.refund_credit_spend(
            self.user["id"], "forge:one"
        )
        self.assertTrue(refund["applied"])
        self.assertFalse(duplicate_refund["applied"])
        self.assertEqual(
            duplicate_refund["balance"],
            {"promo": 6, "paid": 8, "total": 14},
        )

    def test_insufficient_spend_does_not_write_a_charge(self):
        self.database.grant_credits(
            self.user["id"], 4, "welcome_grant", "grant:small"
        )

        result = self.database.spend_credits(
            self.user["id"], 10, "world_forge", "forge:too-expensive"
        )

        self.assertFalse(result["spent"])
        self.assertEqual(result["balance"]["total"], 4)
        with self.database.get_connection() as conn:
            charge_count = conn.execute("""
                SELECT COUNT(*) FROM credit_ledger WHERE amount < 0
            """).fetchone()[0]
        self.assertEqual(charge_count, 0)

    def test_play_starts_and_session_completions_are_idempotent(self):
        world_id = self.make_world("Clockwork Harbor")

        first_start = self.database.record_world_play_start(
            "session-1", world_id, self.user["id"]
        )
        second_start = self.database.record_world_play_start(
            "session-1", world_id, self.user["id"]
        )
        first_completion = self.database.record_world_completion(
            "session-1", world_id, self.user["id"], reward_amount=1,
            daily_reward_cap=5,
        )
        second_completion = self.database.record_world_completion(
            "session-1", world_id, self.user["id"], reward_amount=1,
            daily_reward_cap=5,
        )

        self.assertTrue(first_start["applied"])
        self.assertFalse(second_start["applied"])
        self.assertTrue(first_completion["reward_granted"])
        self.assertFalse(second_completion["applied"])
        self.assertEqual(self.database.get_credit_balance(self.user["id"])["total"], 1)
        self.assertEqual(self.database.get_world_metrics(world_id), {
            "play_count": 1,
            "completion_count": 1,
            "unique_completer_count": 1,
        })

    def test_reward_is_once_per_distinct_world_and_capped_daily(self):
        world_ids = [self.make_world(f"World {index}") for index in range(4)]
        rewards = []
        for index, world_id in enumerate(world_ids[:3]):
            result = self.database.record_world_completion(
                f"session-{index}", world_id, self.user["id"],
                reward_amount=1, daily_reward_cap=2,
            )
            rewards.append(result["reward_granted"])

        repeat = self.database.record_world_completion(
            "session-repeat", world_ids[0], self.user["id"],
            reward_amount=1, daily_reward_cap=2,
        )

        self.assertEqual(rewards, [True, True, False])
        self.assertFalse(repeat["reward_granted"])
        self.assertFalse(repeat["first_distinct_completion"])
        self.assertEqual(self.database.get_credit_balance(self.user["id"])["total"], 2)
        self.assertEqual(
            self.database.get_world_metrics(world_ids[0])["completion_count"], 2
        )
        self.assertEqual(
            self.database.get_world_metrics(world_ids[0])["unique_completer_count"], 1
        )

    def test_creator_completion_is_not_popularity_but_anonymous_play_counts(self):
        owned_world = self.make_world("Owned World", owner_id=self.user["id"])
        creator_completion = self.database.record_world_completion(
            "creator-session", owned_world, self.user["id"],
            reward_amount=1, daily_reward_cap=5,
        )
        anonymous_completion = self.database.record_world_completion(
            "anonymous-session", owned_world, None,
        )

        self.assertTrue(creator_completion["reward_granted"])
        self.assertEqual(anonymous_completion["credits_granted"], 0)
        metrics = self.database.get_world_metrics(owned_world)
        self.assertEqual(metrics["play_count"], 2)
        self.assertEqual(metrics["completion_count"], 2)
        self.assertEqual(metrics["unique_completer_count"], 0)

        listed = self.database.list_worlds(owner_id=self.user["id"])[0]
        self.assertEqual(listed["play_count"], 2)
        self.assertEqual(listed["completion_count"], 2)

    def test_creator_milestones_are_atomic_idempotent_promo_grants(self):
        self.assertEqual(
            get_creator_milestone_rewards(),
            ((5, 5), (20, 10), (50, 20)),
        )
        creator = self.database.create_user("creator", "Secret123!")
        world_id = self.make_world("Creator World", owner_id=creator["id"])
        players = [
            self.database.create_user(f"player-{index}", "Secret123!")
            for index in range(4)
        ]
        test_milestones = ((2, 5), (3, 10), (4, 20))

        creator_grants = []
        for index, player in enumerate(players):
            result = self.database.record_world_completion(
                f"milestone-session-{index}", world_id, player["id"],
                creator_milestones=test_milestones,
            )
            creator_grants.append(result["creator_reward"]["credits_granted"])

        duplicate_session = self.database.record_world_completion(
            "milestone-session-3", world_id, players[3]["id"],
            creator_milestones=test_milestones,
        )
        repeat_player = self.database.record_world_completion(
            "repeat-player-session", world_id, players[0]["id"],
            creator_milestones=test_milestones,
        )
        creator_completion = self.database.record_world_completion(
            "creator-own-session", world_id, creator["id"],
            creator_milestones=test_milestones,
        )

        self.assertEqual(creator_grants, [0, 5, 10, 20])
        self.assertFalse(duplicate_session["creator_reward"]["reward_granted"])
        self.assertFalse(repeat_player["creator_reward"]["reward_granted"])
        self.assertFalse(creator_completion["creator_reward"]["reward_granted"])
        self.assertEqual(
            self.database.get_credit_balance(creator["id"]),
            {"promo": 35, "paid": 0, "total": 35},
        )
        self.assertEqual(
            self.database.get_world_metrics(world_id)["unique_completer_count"],
            4,
        )
        self.assertEqual(
            self.database.get_user_world_stats(creator["id"])[
                "creator_reward_credits"
            ],
            35,
        )
        with self.database.get_connection() as conn:
            ledger_rows = conn.execute("""
                SELECT operation_key, amount, bucket
                FROM credit_ledger
                WHERE kind = 'creator_milestone_reward'
                ORDER BY amount
            """).fetchall()
        self.assertEqual(
            [(row[0], row[1], row[2]) for row in ledger_rows],
            [
                (f"creator_milestone:{world_id}:2", 5, "promo"),
                (f"creator_milestone:{world_id}:3", 10, "promo"),
                (f"creator_milestone:{world_id}:4", 20, "promo"),
            ],
        )

    def test_failed_art_reroll_restores_the_single_free_allowance(self):
        world_id = self.make_world("Reroll World", owner_id=self.user["id"])

        first = self.database.reserve_free_world_art_reroll(
            world_id, self.user["id"]
        )
        blocked_while_running = self.database.reserve_free_world_art_reroll(
            world_id, self.user["id"]
        )
        self.database.finish_world_art_reroll(first, succeeded=False)
        retry = self.database.reserve_free_world_art_reroll(
            world_id, self.user["id"]
        )
        self.database.finish_world_art_reroll(retry, succeeded=True)

        self.assertIsNotNone(first)
        self.assertIsNone(blocked_while_running)
        self.assertIsNotNone(retry)
        self.assertIsNone(
            self.database.reserve_free_world_art_reroll(world_id, self.user["id"])
        )
        self.assertEqual(
            self.database.get_free_world_art_rerolls_remaining(
                world_id, self.user["id"]
            ),
            0,
        )


if __name__ == "__main__":
    unittest.main()
