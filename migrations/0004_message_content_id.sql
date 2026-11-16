-- New hosted messages get an id derived from their encrypted text (see src/lib/message-id.ts), so the same block
-- always has the same link and pasted encrypted text can be matched to its page.
--
-- Rows made before this keep their random UUID id and their links keep working. content_id holds the derived id
-- for those rows, so they are found from their encrypted text too. SQLite cannot compute SHA-256, so it is not
-- filled in here: the app fills it in the first time such a row is read. It stays NULL for new rows, whose id
-- already is the derived id.
ALTER TABLE messages ADD COLUMN content_id TEXT;

CREATE INDEX IF NOT EXISTS messages_content_id ON messages (content_id) WHERE content_id IS NOT NULL;
