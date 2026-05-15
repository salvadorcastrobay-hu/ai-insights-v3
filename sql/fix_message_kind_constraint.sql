-- Relax campaign_advisor_messages.message_kind to match the actual values
-- emitted by src/api/main.py: prompt, recommendation, followup,
-- followup_answer, translation. The legacy `initial_question` is kept
-- for backward compatibility with any existing rows.

BEGIN;

ALTER TABLE campaign_advisor_messages
    DROP CONSTRAINT IF EXISTS campaign_advisor_messages_message_kind_check;

ALTER TABLE campaign_advisor_messages
    ADD CONSTRAINT campaign_advisor_messages_message_kind_check
    CHECK (message_kind IN (
        'initial_question',  -- legacy, kept for compat
        'prompt',            -- user's initial request
        'recommendation',    -- assistant initial response
        'followup',          -- user follow-up
        'followup_answer',   -- assistant follow-up response
        'translation'        -- assistant translation pass
    ));

COMMIT;
