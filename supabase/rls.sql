alter table public.tasks enable row level security;
alter table public.evm_address enable row level security;
alter table public.sol_address enable row level security;

revoke all on table public.tasks from anon, authenticated;
revoke all on table public.evm_address from anon, authenticated;
revoke all on table public.sol_address from anon, authenticated;

revoke all on all sequences in schema public from anon, authenticated;

comment on table public.tasks is '仅允许通过 service_role 访问，前端不直连';
comment on table public.evm_address is '仅允许通过 service_role 访问，前端不直连';
comment on table public.sol_address is '仅允许通过 service_role 访问，前端不直连';
