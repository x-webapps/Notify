-- Run once in the Supabase SQL editor. Replace with YOUR Google account email (lowercase).
insert into public.admins (email) values ('you@gmail.com')
on conflict do nothing;
