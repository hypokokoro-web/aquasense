-- Curated reference passages retrieved for AquaSense AI responses.
create table if not exists public.aquasense_knowledge_chunks (
  id bigint generated always as identity primary key,
  title text not null,
  content text not null,
  source_title text not null,
  source_url text,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (title, source_title)
);

create index if not exists aquasense_knowledge_search_idx
  on public.aquasense_knowledge_chunks using gin (search_vector);

alter table public.aquasense_knowledge_chunks enable row level security;
drop policy if exists "Admins can read AquaSense knowledge" on public.aquasense_knowledge_chunks;
create policy "Admins can read AquaSense knowledge"
  on public.aquasense_knowledge_chunks for select
  to authenticated using (public.is_aquasense_admin());

create or replace function public.search_aquasense_knowledge(search_text text, result_limit integer default 4)
returns table (id bigint, title text, content text, source_title text, source_url text, rank real)
language sql
stable
security invoker
set search_path = public
as $$
  select k.id, k.title, k.content, k.source_title, k.source_url,
         ts_rank_cd(k.search_vector, websearch_to_tsquery('english', search_text)) as rank
  from public.aquasense_knowledge_chunks k
  where k.search_vector @@ websearch_to_tsquery('english', search_text)
  order by rank desc, k.id
  limit greatest(1, least(coalesce(result_limit, 4), 8));
$$;

revoke all on function public.search_aquasense_knowledge(text, integer) from public, anon;
grant execute on function public.search_aquasense_knowledge(text, integer) to authenticated, service_role;

insert into public.aquasense_knowledge_chunks (title, content, source_title, source_url) values
('Aquarium nitrogen cycle', 'Beneficial bacteria convert toxic ammonia from fish waste and uneaten food into nitrite, then other bacteria convert nitrite into nitrate. A new aquarium needs time to establish these bacteria. Check ammonia and nitrite during cycling, add livestock gradually, and do not treat clear water as proof that a tank is cycled. Water changes dilute waste but do not instantly establish biological filtration.', 'USGS: Ammonia in the Environment', 'https://www.usgs.gov/special-topics/water-science-school/science/ammonia-and-water'),
('Ammonia and fish safety', 'Ammonia is toxic to aquatic life. The toxic un-ionized fraction increases as pH and temperature rise, so the same total-ammonia reading can pose different risk under different conditions. Test promptly when fish show distress or a new tank is cycling. Avoid abrupt corrective changes; use water changes and sound biofiltration, and seek species-specific guidance for treatment.', 'US EPA: Aquatic Life Criteria for Ammonia', 'https://www.epa.gov/wqc/aquatic-life-criteria-ammonia'),
('Dissolved oxygen and temperature', 'Warm water holds less dissolved oxygen than cooler water. Fish, plants at night, and bacteria consume oxygen, while surface agitation promotes gas exchange. If fish are gasping at the surface, increase aeration and check temperature and water quality immediately; do not assume a temperature reading alone measures dissolved oxygen.', 'USGS: Dissolved Oxygen and Water', 'https://www.usgs.gov/special-topics/water-science-school/science/dissolved-oxygen-and-water'),
('pH stability and aquarium fish', 'pH describes how acidic or basic water is, but a single universal target does not fit every fish. Match the needs of the species and the source water, and favor stability over chasing a number with repeated chemical adjustments. Sudden pH changes can stress fish. Test alkalinity or carbonate hardness when pH is unstable because buffering affects how readily pH changes.', 'USGS: pH and Water', 'https://www.usgs.gov/special-topics/water-science-school/science/ph-and-water'),
('Aquarium temperature changes', 'Fish are adapted to different temperature ranges, so use the target range for the species being kept. Make temperature changes gradually and verify heater performance with an independent thermometer. Higher temperatures raise fish metabolic oxygen demand while reducing oxygen solubility, which can compound stress.', 'USGS: Water Properties and Temperature', 'https://www.usgs.gov/special-topics/water-science-school/science/water-properties-temperature'),
('Water changes and tap water', 'Partial water changes help dilute accumulated dissolved waste, but replacement water should be close in temperature and treated for chlorine or chloramine when present. The right amount and schedule depend on stocking, filtration, feeding, and test results. Avoid replacing all aquarium water or cleaning all biological filter media at once, which can destabilize the system.', 'US EPA: Chloramines in Drinking Water', 'https://www.epa.gov/dwreginfo/chloramines-drinking-water'),
('Fish quarantine and disease prevention', 'Quarantine newly acquired fish in a separate, appropriately equipped tank when possible. Observe behavior, appetite, breathing, and visible signs before introducing them to an established aquarium. Use separate nets and equipment to reduce pathogen transfer, and avoid medicating fish without a reason and an appropriate diagnosis.', 'Merck Veterinary Manual: Management of Aquarium Fish', 'https://www.merckvetmanual.com/exotic-and-laboratory-animals/aquarium-fish/management-of-aquarium-fish'),
('AquaSense sensor interpretation', 'AquaSense sensor readings describe only the parameters measured by the connected sensors. Temperature and pH readings do not reveal ammonia, nitrite, nitrate, dissolved oxygen, salinity, or disease. Check the reading timestamp and source, compare with a calibrated independent test when fish health is at stake, and never infer an unmeasured value from temperature or pH.', 'AquaSense product guidance', null)
on conflict (title, source_title) do update set
  content = excluded.content,
  source_url = excluded.source_url;
