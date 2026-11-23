ALTER TABLE game_round ADD COLUMN score_limit INTEGER CHECK (score_limit > 0);
--> statement-breakpoint
ALTER TABLE players ADD COLUMN score_excluded INTEGER NOT NULL DEFAULT 0 CHECK (score_excluded IN (0, 1));
