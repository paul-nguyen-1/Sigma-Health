-- Seeds a few days of daily_sessions (today + next 2 days, one per
-- sport) so the opt-in "session of the day" path has something to show
-- during QA. Not a migration -- daily_sessions are calendar-date content,
-- not fixed schema data, so hardcoding literal dates into migration
-- history would go stale immediately. Uses CURRENT_DATE so this stays
-- runnable/evergreen; re-run anytime to top up the next few days.
--
-- Usage: docker run --rm -i postgres:16 psql "$DATABASE_URL" < api/seed/daily-sessions.sql
INSERT INTO daily_sessions (sport_id, date, title, target)
SELECT id, CURRENT_DATE + offset_days, title, target::jsonb
FROM sports
CROSS JOIN (
    VALUES
        (0, 'WOD: Squat Ladder', '{"exercises": [{"name": "Back Squat", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}, {"name": "Push-up", "sets": [{"weight": 0, "reps": 15}, {"weight": 0, "reps": 15}]}]}'),
        (1, 'WOD: Pull + Press', '{"exercises": [{"name": "Pull-up", "sets": [{"weight": 0, "reps": 8}, {"weight": 0, "reps": 8}, {"weight": 0, "reps": 8}]}, {"name": "Overhead Press", "sets": [{"weight": 0, "reps": 8}, {"weight": 0, "reps": 8}]}]}'),
        (2, 'WOD: Deadlift Day', '{"exercises": [{"name": "Deadlift", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}]}')
) AS d(offset_days, title, target)
WHERE sports.slug = 'lifting'
ON CONFLICT (sport_id, date) DO NOTHING;

INSERT INTO daily_sessions (sport_id, date, title, target)
SELECT id, CURRENT_DATE + offset_days, title, target::jsonb
FROM sports
CROSS JOIN (
    VALUES
        (0, 'WOD: Easy 3K', '{"distanceKm": 3, "targetPaceSecPerKm": null}'),
        (1, 'WOD: Tempo 5K', '{"distanceKm": 5, "targetPaceSecPerKm": 330}'),
        (2, 'WOD: Long Run', '{"distanceKm": 8, "targetPaceSecPerKm": null}')
) AS d(offset_days, title, target)
WHERE sports.slug = 'running'
ON CONFLICT (sport_id, date) DO NOTHING;
