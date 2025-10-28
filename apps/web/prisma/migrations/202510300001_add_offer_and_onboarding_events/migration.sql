-- meta: migration: analytics-events
CREATE TABLE IF NOT EXISTS checkout_offer_events (
    id UUID PRIMARY KEY,
    order_reference TEXT,
    event_type TEXT NOT NULL,
    selection JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkout_offer_events_order_reference
    ON checkout_offer_events (order_reference);
CREATE INDEX IF NOT EXISTS idx_checkout_offer_events_event_type
    ON checkout_offer_events (event_type);

CREATE INDEX IF NOT EXISTS idx_onboarding_journey_events_order_id
    ON onboarding_journey_events (order_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_journey_events_event_type
    ON onboarding_journey_events (event_type);
