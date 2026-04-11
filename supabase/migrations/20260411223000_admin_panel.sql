create table if not exists public.admin_email_allowlist (
  email text primary key
);

alter table public.admin_email_allowlist enable row level security;

revoke all on public.admin_email_allowlist from public, anon, authenticated;

insert into public.admin_email_allowlist (email)
values ('ozgekiters@gmail.com')
on conflict (email) do nothing;

create or replace function public.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_email_allowlist a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.admin_list_user_credits()
returns table (
  user_id uuid,
  email text,
  balance integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select
    u.id::uuid as user_id,
    coalesce(u.email, '')::text as email,
    coalesce(c.credits, 0)::integer as balance
  from auth.users u
  left join public.credits c
    on c.user_id = u.id
  order by lower(coalesce(u.email, '')), u.created_at desc;
end;
$$;

create or replace function public.admin_add_credits(
  p_user_id uuid,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_balance integer;
  v_email text;
begin
  if not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be a positive integer';
  end if;

  select u.email
  into v_email
  from auth.users u
  where u.id = p_user_id;

  if v_email is null then
    raise exception 'User not found';
  end if;

  insert into public.credits (user_id, email, credits, updated_at)
  values (p_user_id, v_email, p_amount, now())
  on conflict (user_id) do update
    set email = excluded.email,
        credits = coalesce(public.credits.credits, 0) + excluded.credits,
        updated_at = now()
  returning public.credits.credits into v_balance;

  return v_balance;
end;
$$;

revoke all on function public.is_current_admin() from public, anon, authenticated;

revoke all on function public.admin_list_user_credits() from public, anon, authenticated;
grant execute on function public.admin_list_user_credits() to authenticated;

revoke all on function public.admin_add_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_add_credits(uuid, integer) to authenticated;
