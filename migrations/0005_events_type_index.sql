-- Recent activity lists encryptions only. This index lets that list be read newest first without scanning past the
-- decryptions in between. It only adds an index: no event is changed or removed.
CREATE INDEX IF NOT EXISTS events_type_id ON events (type, id DESC);
