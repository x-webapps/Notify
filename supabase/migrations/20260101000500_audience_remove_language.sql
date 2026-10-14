-- Language audiences are no longer used.
delete from public.audience_topics where kind = 'language';

alter table public.audience_topics drop constraint if exists audience_topics_kind_check;
alter table public.audience_topics
  add constraint audience_topics_kind_check
  check (kind in ('custom', 'version', 'country', 'timezone'));
