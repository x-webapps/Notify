-- Device-local-time sends: one parent row (what the admin sees) + one child row per UTC offset.
--   kind            : 'single' (normal), 'local_parent' (never sent itself), 'local_child' (one per offset)
--   parent_id       : set on children
--   local_offset_min: the UTC offset (minutes) a child targets, e.g. 330 for UTC+05:30
--   local_time      : 'HH:MM' wall-clock time requested (on the parent)

alter table public.notifications
  add column if not exists kind text not null default 'single'
    check (kind in ('single', 'local_parent', 'local_child')),
  add column if not exists parent_id uuid references public.notifications(id) on delete cascade,
  add column if not exists local_offset_min integer check (local_offset_min between -720 and 840),
  add column if not exists local_time text check (local_time ~ '^[0-2][0-9]:[0-5][0-9]$');

create index if not exists notifications_parent_idx on public.notifications (parent_id);
create index if not exists notifications_kind_created_idx on public.notifications (app_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- The scheduler must never pick up a parent row.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_notifications(p_limit int default 20)
returns setof public.notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Recover rows whose function run died before it could record a result.
  update public.notifications
     set status = 'failed', error = 'Timed out while sending (the function did not finish)'
   where status = 'sending' and claimed_at < now() - interval '15 minutes'
     and kind <> 'local_parent';

  return query
  update public.notifications n
     set status = 'sending', claimed_at = now()
   where n.id in (
     select id from public.notifications
      where status = 'scheduled' and scheduled_at <= now() and kind <> 'local_parent'
      order by scheduled_at
      limit p_limit
      for update skip locked
   )
  returning n.*;
end;
$$;

revoke all on function public.claim_due_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(int) to service_role;

-- ---------------------------------------------------------------------------
-- Keep the parent's status in step with its children.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_local_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid := coalesce(new.parent_id, old.parent_id);
  n_total int; n_sched int; n_sending int; n_sent int; n_failed int;
  last_sent timestamptz; first_due timestamptz; new_status text;
begin
  if pid is null then
    return null;
  end if;

  select count(*),
         count(*) filter (where status = 'scheduled'),
         count(*) filter (where status = 'sending'),
         count(*) filter (where status = 'sent'),
         count(*) filter (where status = 'failed'),
         max(sent_at),
         min(scheduled_at) filter (where status = 'scheduled')
    into n_total, n_sched, n_sending, n_sent, n_failed, last_sent, first_due
    from public.notifications
   where parent_id = pid;

  if n_total = 0 then
    return null;
  end if;

  new_status := case
    when n_sending > 0 then 'sending'
    when n_sched > 0 then 'scheduled'
    when n_sent > 0 then 'sent'
    when n_failed > 0 then 'failed'
    else 'cancelled'
  end;

  update public.notifications
     set status = new_status,
         sent_at = case when new_status = 'sent' then last_sent else sent_at end,
         scheduled_at = coalesce(first_due, scheduled_at),
         error = case
           when n_failed > 0 and n_sent > 0 then n_failed || ' of ' || n_total || ' time zones failed'
           when new_status = 'failed' then 'All time zones failed'
           else null
         end
   where id = pid;

  return null;
end;
$$;

drop trigger if exists notifications_refresh_parent on public.notifications;
create trigger notifications_refresh_parent
  after insert or update of status or delete on public.notifications
  for each row execute function public.refresh_local_parent();
