CREATE TABLE players (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  team TEXT NOT NULL CHECK (team IN ('dog', 'dragon', 'cat')),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE answers (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  prompt_id INTEGER NOT NULL CHECK (prompt_id BETWEEN 1 AND 30),
  match_name TEXT NOT NULL,
  match_team TEXT NOT NULL CHECK (match_team IN ('dog', 'dragon', 'cat')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, prompt_id)
);
