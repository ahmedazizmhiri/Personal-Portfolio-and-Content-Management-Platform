alter table public.social_links
  add column if not exists link_group text default 'primary',
  add column if not exists show_in_contact boolean default true,
  add column if not exists show_in_footer boolean default true,
  add column if not exists include_in_same_as boolean default false,
  add column if not exists icon_url text;

update public.social_links
set slug = case
  when lower(trim(coalesce(icon_key, label))) = 'linkedin'
    or lower(trim(label)) = 'linkedin'
    then 'linkedin'
  when lower(trim(coalesce(icon_key, label))) = 'github'
    or lower(trim(label)) = 'github'
    then 'github'
  when lower(trim(coalesce(icon_key, label))) = 'email'
    or lower(trim(label)) = 'email'
    then 'email'
  else coalesce(
    nullif(
      trim(
        both '-'
        from regexp_replace(
          lower(trim(label)),
          '[^a-z0-9]+',
          '-',
          'g'
        )
      ),
      ''
    ),
    'link'
  ) || '-' || left(id::text, 8)
end
where slug is null or trim(slug) = '';

update public.social_links
set
  link_group = 'primary',
  show_in_contact = true,
  show_in_footer = true,
  include_in_same_as = slug in ('linkedin', 'github'),
  published = true,
  sort_order = case
    when slug = 'email' then 0
    when slug = 'linkedin' then 10
    when slug = 'github' then 20
    else sort_order
  end
where slug in ('email', 'linkedin', 'github');

alter table public.social_links
  alter column slug set not null,
  alter column link_group set not null,
  alter column show_in_contact set not null,
  alter column show_in_footer set not null,
  alter column include_in_same_as set not null;

alter table public.social_links
  add constraint social_links_slug_key unique (slug);

alter table public.social_links
  add constraint social_links_slug_format_check
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table public.social_links
  add constraint social_links_link_group_check
  check (link_group in ('primary', 'freelance'));

insert into public.social_links (
  label,
  slug,
  url,
  link_group,
  icon_key,
  icon_url,
  show_in_contact,
  show_in_footer,
  include_in_same_as,
  sort_order,
  published
)
values (
  'Upwork',
  'upwork',
  'https://www.upwork.com/freelancers/~0102fbf36d3fefe947',
  'freelance',
  null,
  null,
  true,
  true,
  true,
  40,
  true
)
on conflict (slug) do nothing;