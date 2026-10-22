-- Nightly cleanup: History rows older than 30 days are deleted, so the notifications table stays small
-- no matter how many apps send. Nothing that is still waiting is touched.
--
-- Only finished rows go (sent, failed, cancelled). Scheduled and sending rows stay. Time-zone children of a
-- local-time send are not selected on their own: they disappear with their parent (on delete cascade), and a
-- parent stays "scheduled" until every child is done, so a send planned far ahead is never cut in half.
-- Uploaded images in the notification-images bucket are not removed by this.

create or replace function public.purge_old_notifications(p_days int default 30)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  removed bigint := 0;
  n bigint;
begin
  if p_days < 7 then
    raise exception 'Refusing to keep fewer than 7 days of history.';
  end if;
  loop
    -- Small batches keep each delete short, so a large backlog never blocks sending.
    delete from public.notifications
     where id in (
       select id from public.notifications
        where created_at < now() - make_interval(days => p_days)
          and status in ('sent', 'failed', 'cancelled')
          and kind <> 'local_child'
        order by created_at
        limit 2000
        for update skip locked
     );
    get diagnostics n = row_count;
    removed := removed + n;
    exit when n = 0;
  end loop;
  return removed;
end;
$$;

revoke all on function public.purge_old_notifications(int) from public, anon, authenticated;
grant execute on function public.purge_old_notifications(int) to service_role;

-- Every night at 03:17 UTC (pg_cron runs it as the database owner).
do $do$
begin
  if to_regclass('cron.job') is not null then
    perform cron.schedule('purge-old-notifications', '17 3 * * *', 'select public.purge_old_notifications(30)');
  end if;
end
$do$;
