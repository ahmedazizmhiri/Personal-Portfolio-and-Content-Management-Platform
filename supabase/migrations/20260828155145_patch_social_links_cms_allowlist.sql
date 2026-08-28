do $social_links_mutation_allowlist$
declare
  v_function_oid oid;
  v_definition text;
  v_updated_definition text;
  v_old_fragment constant text :=
    '''label'', ''url'', ''icon_key'', ''sort_order'', ''published''';
  v_new_fragment constant text :=
    '''label'', ''slug'', ''url'', ''link_group'', ''icon_key'', ''icon_url'', ''show_in_contact'', ''show_in_footer'', ''include_in_same_as'', ''sort_order'', ''published''';
  v_occurrences integer;
  v_owner oid;
  v_acl pg_catalog.aclitem[];
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.mutate_cms_content(text,text,uuid,timestamp with time zone,jsonb,uuid)'
  );

  if v_function_oid is null then
    raise exception using
      errcode = 'P0001',
      message = 'Social links CMS allowlist patch failed: atomic CMS mutation RPC is missing';
  end if;

  select
    pg_catalog.pg_get_functiondef(proc.oid),
    proc.proowner,
    proc.proacl
  into v_definition, v_owner, v_acl
  from pg_catalog.pg_proc as proc
  where proc.oid = v_function_oid;

  if pg_catalog.strpos(v_definition, v_new_fragment) > 0 then
    null;
  else
    v_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(
          pg_catalog.replace(v_definition, v_old_fragment, '')
        )
    ) / pg_catalog.length(v_old_fragment);

    if v_occurrences <> 1 then
      raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
          'Social links CMS allowlist patch failed: expected the old social_links allowlist exactly once, found %s',
          v_occurrences
        );
    end if;

    v_updated_definition := pg_catalog.replace(
      v_definition,
      v_old_fragment,
      v_new_fragment
    );

    execute v_updated_definition;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as proc
    where proc.oid = v_function_oid
      and proc.proowner = v_owner
      and proc.proacl is not distinct from v_acl
      and proc.prosecdef
      and 'search_path=""' = any(
        coalesce(proc.proconfig, array[]::text[])
      )
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(proc.oid),
        v_new_fragment
      ) > 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Social links CMS allowlist patch failed: RPC security metadata or allowlist is incorrect';
  end if;
end
$social_links_mutation_allowlist$;