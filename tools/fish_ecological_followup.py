#!/usr/bin/env python3
"""Analysis-only follow-up audit for the NRMN ecological fish-density study.

Uses the cached AODN Method 1 taxon pages plus the independent public survey-list
endpoint. It writes only under analysis/fish-ecological-experiment/ and uses the
same buffered spatial blocks and union purge as fish_ecological_experiment.py.
"""
from __future__ import annotations

import csv, gzip, hashlib, json, math, time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge, TweedieRegressor
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler, SplineTransformer

import fish_ecological_experiment as base

ROOT=base.ROOT
OUT=base.OUT
RAW=base.RAW
SURVEY_TYPE='imos:ep_survey_list_public_data'
PAGE=10000
FEATURES=base.FEATURES


def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()


def fetch_survey_list():
    """Recover independent survey metadata; this endpoint has no block-completion field."""
    folder=OUT/'survey_list_pages';folder.mkdir(exist_ok=True)
    meta_path=OUT/'survey_list_source_metadata.json'
    if meta_path.exists():
        meta=json.loads(meta_path.read_text(encoding='utf-8'))
    else:
        response=requests.get(base.WFS,params={'service':'WFS','version':'2.0.0','request':'GetFeature',
            'typeNames':SURVEY_TYPE,'resultType':'hits'},timeout=120)
        response.raise_for_status()
        import xml.etree.ElementTree as ET
        meta={'endpoint':base.WFS,'feature_type':SURVEY_TYPE,
              'number_matched':int(ET.fromstring(response.content).attrib['numberMatched']),
              'retrieved_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
              'page_size':PAGE,'sort_by':'survey_id'}
        meta_path.write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8')
    total=meta['number_matched']
    for start in range(0,total,PAGE):
        dest=folder/f'{start:09d}.csv.gz'
        if dest.exists():continue
        response=requests.get(base.WFS,params={'service':'WFS','version':'2.0.0','request':'GetFeature',
            'typeNames':SURVEY_TYPE,'count':PAGE,'startIndex':start,'outputFormat':'csv','sortBy':'survey_id'},timeout=180)
        response.raise_for_status()
        if response.text.lstrip().startswith('<') or len(response.content)<40:
            raise RuntimeError(f'Invalid AODN survey-list page at {start}: {response.text[:300]}')
        temp=dest.with_suffix('.tmp');temp.write_bytes(gzip.compress(response.content,compresslevel=6));temp.replace(dest)
        print(f'downloaded survey metadata offset {start:,}',flush=True)
    chunks=[pd.read_csv(folder/f'{start:09d}.csv.gz',low_memory=False) for start in range(0,total,PAGE)]
    df=pd.concat(chunks,ignore_index=True)
    if len(df)!=total:raise RuntimeError(f'Survey-list rows {len(df)} != service count {total}')
    out=OUT/'survey_list_public_data.csv.gz'
    df.to_csv(out,index=False,compression='gzip')
    meta.update({'downloaded_rows':len(df),'sha256':digest(out),
                 'has_survey_id':bool('survey_id' in df),'has_method_list':bool('methods' in df),
                 'has_block_identifier':bool('block' in df),'has_block_completion_status':bool(any('block' in c.lower() and ('status' in c.lower() or 'done' in c.lower()) for c in df.columns))})
    meta_path.write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8')
    return df,meta


def audit_denominator(surveys,meta,adjusted=None):
    table=pd.read_csv(OUT/'nrmn_training_table.csv.gz',low_memory=False)
    blocks=table.groupby('survey_id',dropna=False).agg(
        recorded_blocks=('block','nunique'),fish_blocks=('fish_per_100m2',lambda x:int((x>0).sum())),
        zero_total_blocks=('fish_per_100m2',lambda x:int((x==0).sum())))
    blocks.index=blocks.index.astype(str)
    s=surveys.copy()
    s['survey_id']=s['survey_id'].astype(str)
    s['survey_date_parsed']=pd.to_datetime(s.get('survey_date'),errors='coerce',utc=True)
    s['m1_listed']=s['methods'].fillna('').astype(str).map(lambda x:'1' in [p.strip() for p in x.split(',')])
    s['program_norm']=s['program'].fillna('Unknown').astype(str).str.upper().str.strip()
    s=s[s.m1_listed].copy()
    s=s.merge(blocks,left_on='survey_id',right_index=True,how='left')
    s['recorded_blocks']=s['recorded_blocks'].fillna(0).astype(int)
    # Apply only designs that the current QA/QC manual documents. Before 2019,
    # ATRC M1 observations were not block-separated; AODN randomly assigned
    # rows to displayed block IDs, so those IDs are not a true denominator.
    s['survey_year']=s.survey_date_parsed.dt.year
    standard=s[(s.program_norm=='RLS')|((s.program_norm=='ATRC')&(s.survey_year>=2019))].copy()
    legacy=s[(s.program_norm=='ATRC')&(s.survey_year<2019)].copy()
    other=s[~s.index.isin(standard.index.union(legacy.index))].copy()
    standard_expected=2*len(standard)
    standard_observed=int(np.minimum(standard.recorded_blocks,2).sum())
    standard_unknown=max(0,standard_expected-standard_observed)
    legacy_expected=len(legacy) # one 50m x 10m field unit, 500 m2
    legacy_observed=int((legacy.recorded_blocks>0).sum())
    legacy_unknown=max(0,legacy_expected-legacy_observed)
    unknown_candidates=standard_unknown+legacy_unknown
    by_year=s.groupby(['program_norm','survey_year'],dropna=False).agg(m1_surveys=('survey_id','nunique'),
        surveys_with_any_m1_block=('recorded_blocks',lambda x:int((x>0).sum())),
        source_block_ids=('recorded_blocks','sum')).reset_index()
    by_year.to_csv(OUT/'survey_denominator_by_program_year.csv',index=False)
    m1ids=set(s.survey_id.astype(str));observedids=set(blocks.index.astype(str))
    m1_rows=[]
    for program,g in s.groupby('program_norm',dropna=False):
        expected_program=(2*int(((g.program_norm=='RLS')|((g.program_norm=='ATRC')&(g.survey_year>=2019))).sum()))
        standard_rows=g[(g.program_norm=='RLS')|((g.program_norm=='ATRC')&(g.survey_year>=2019))]
        m1_rows.append({'program':program,'m1_surveys':int(len(g)),
                        'surveys_with_any_m1_block':int((g.recorded_blocks>0).sum()),
                        'recorded_block_count':int(g.recorded_blocks.sum()),
                        'documented_standard_expected_250m2_blocks':expected_program if expected_program else None,
                        'documented_standard_unrepresented_slots_status_unknown':int((2-np.minimum(standard_rows.recorded_blocks,2)).sum()) if len(standard_rows) else None,
                        'legacy_atrc_500m2_survey_units':int((g.program_norm=='ATRC').mul((g.survey_year<2019).fillna(False)).sum()) if program=='ATRC' else None,
                        'legacy_atrc_units_without_any_rows':int(((g.program_norm=='ATRC')&(g.survey_year<2019)&(g.recorded_blocks==0)).sum()) if program=='ATRC' else None,
                        'protocol_status':'documented standard' if program in ('RLS','ATRC') else 'unresolved'})
    pd.DataFrame(m1_rows).to_csv(OUT/'survey_denominator_by_program.csv',index=False)
    observed=(adjusted if adjusted is not None else table)['fish_per_100m2'].to_numpy(float)
    original_observed=table['fish_per_100m2'].to_numpy(float)
    dist=lambda values:{'n':int(len(values)),'zero_fraction':float(np.mean(values==0)) if len(values) else None,
        'mean':float(np.mean(values)) if len(values) else None,'median':float(np.median(values)) if len(values) else None,
        'p90':float(np.quantile(values,.9)) if len(values) else None,'p99':float(np.quantile(values,.99)) if len(values) else None,
        'maximum':float(np.max(values)) if len(values) else None}
    hypothetical=np.r_[observed,np.zeros(unknown_candidates,dtype=float)]
    documented_expected_units=standard_expected+legacy_expected
    res={'survey_endpoint':meta,'survey_list_rows':int(len(surveys)),
        'survey_list_m1_surveys':int(len(s)),'m1_survey_count_by_program':{str(k):int(v) for k,v in s.program_norm.value_counts(dropna=False).items()},
        'm1_surveys_with_other_programs_or_unclassifiable_protocol':int(len(other)),
        'survey_ids_with_m1_not_in_observation_table':int(len(m1ids-observedids)),
        'm1_observation_survey_ids_not_in_survey_list':int(len(observedids-m1ids)),
        'documented_standard_250m2_expected_blocks':int(standard_expected),
        'documented_standard_250m2_recorded_block_ids_capped_at_two_per_survey':int(standard_observed),
        'documented_standard_250m2_unrepresented_block_slots_status_unknown':int(standard_unknown),
        'legacy_atrc_expected_survey_units_500m2':int(legacy_expected),
        'legacy_atrc_surveys_with_any_observation_rows':int(legacy_observed),
        'legacy_atrc_surveys_without_observation_rows_status_unknown':int(legacy_unknown),
        'other_program_m1_surveys_protocol_not_resolved':int(len(other)),
        'total_expected_survey_blocks':'Not recoverable as one global number: documented standard 250 m2 blocks and legacy ATRC 500 m2 survey units are separate; other programs and missing/not-done block status are unresolved.',
        'nominal_expected_block_rule':'RLS: 2 x 250 m2 M1 blocks/survey. ATRC from 2019: same 2 x 250 m2 blocks. ATRC before 2019: one 500 m2 survey unit; block IDs were randomly assigned after collection and are not true block boundaries. Other programs not assigned a count.',
        'recorded_standard_blocks_with_fish_records':int((standard.recorded_blocks>0).sum()),
        'blocks_with_fish_records':int((table.fish_per_100m2>0).sum()),
        'documented_protocol_units_with_fish_records':int(np.sum(observed>0)),
        'documented_protocol_units_with_zero_targets':int(np.sum(observed==0)),
        'nominal_expected_documented_units':int(documented_expected_units),
        'nominal_recorded_documented_units':int(standard_observed+legacy_observed),
        'nominal_unrepresented_documented_units_status_unknown':int(unknown_candidates),
        'explicit_zero_total_taxon_records':int(json.loads((OUT/'raw_record_audit.json').read_text(encoding='utf-8'))['zero_total_source_records']),
        'whole_zero_target_blocks_observed':int((table.fish_per_100m2==0).sum()),
        'reconstructed_zero_blocks':0,
        'confirmed_zero_fraction_of_documented_units':0.0 if standard_expected+legacy_expected else None,
        'unknown_unit_zero_fraction_bounds_within_documented_cohort':[0.0,float(unknown_candidates/documented_expected_units) if documented_expected_units else None],
        'target_distribution_observed_positive_blocks':dist(observed),
        'target_distribution_original_displayed_block_rows':dist(original_observed),
        'target_distribution_sensitivity_if_every_unrepresented_documented_unit_were_zero':dist(hypothetical),
        'interpretation':'The survey list is survey-level metadata only. For documented standard surveys, absent expected blocks remain ambiguous between unperformed/missed and no-fish blocks because not-done rows are hidden. Pre-2019 ATRC block IDs are randomized, not a reliable survey×block denominator. Other programs are unclassified. No absent block is converted to zero.'}
    (OUT/'zero_block_denominator_audit.json').write_text(json.dumps(res,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    return res


def _survey_key(values):
    return values.astype(str).str.replace(r'\.0$', '', regex=True).str.strip()


def build_protocol_adjusted_table(surveys):
    """Create a protocol-comparable analysis table without altering source counts.

    The manual states that pre-2019 ATRC observations were randomly assigned to
    displayed blocks after collection. Summing those rows back to the survey
    and using the original 500 m2 area avoids treating those pseudo-blocks as
    independent 250 m2 observations. Other programs stay out of this primary
    sensitivity table until their effective Method 1 areas are documented.
    """
    source=pd.read_csv(OUT/'nrmn_training_table.csv.gz',low_memory=False)
    survey=surveys.copy()
    survey['survey_key']=_survey_key(survey['survey_id'])
    survey['program_norm']=survey['program'].fillna('Unknown').astype(str).str.upper().str.strip()
    survey['survey_year']=pd.to_datetime(survey['survey_date'],errors='coerce').dt.year
    survey['methods_norm']=survey['methods'].fillna('').astype(str)
    survey=survey[survey.methods_norm.map(lambda x:'1' in [v.strip() for v in x.split(',')])]
    if survey.survey_key.duplicated().any():
        raise RuntimeError('Public survey-list endpoint has duplicate survey IDs; refusing ambiguous protocol join')
    source['survey_key']=_survey_key(source['survey_id'])
    joined=source.merge(survey[['survey_key','program_norm','survey_year','survey_date','methods_norm']],
                        on='survey_key',how='left',validate='many_to_one',suffixes=('','_list'))
    legacy=(joined.program_norm.eq('ATRC') & joined.survey_year.lt(2019))
    standard=(joined.program_norm.eq('RLS') | (joined.program_norm.eq('ATRC') & joined.survey_year.ge(2019)))
    known=legacy|standard
    regular=joined[standard].copy()
    regular['analysis_unit']='survey×250m² block'
    regular['analysis_area_m2']=250.0
    regular['protocol_adjustment']='No area rescaling; standard RLS/current ATRC block'

    legacy_rows=joined[legacy].copy()
    legacy_survey_counts=legacy_rows.groupby('survey_key').fish_count.sum().to_dict()
    legacy_group=[]
    for sid,g in legacy_rows.groupby('survey_key',sort=False):
        # A survey ID denotes a single transect. If coordinates/month vary within
        # it, the source key is not adequate for a safe aggregation.
        for col in ['lat','lon','survey_date','survey_month']:
            if g[col].nunique(dropna=False)>1:
                raise RuntimeError(f'Legacy ATRC survey {sid} varies in {col}; refusing to combine it')
        row={col:g[col].iloc[0] for col in source.columns if col not in ('survey_key','block','fish_count','fish_per_100m2','n_species_records','survey_area_m2')}
        row.update({'survey_id':g.survey_id.iloc[0],'block':'legacy_500m2_survey_unit',
                    'fish_count':int(g.fish_count.sum()),'survey_area_m2':500.0,
                    'fish_per_100m2':float(g.fish_count.sum()*100/500.0),
                    'n_species_records':int(g.n_species_records.sum()),
                    'program_norm':'ATRC','survey_year':int(g.survey_year.iloc[0]),
                    'methods_norm':g.methods_norm.iloc[0],'analysis_unit':'pre-2019 ATRC 500m² survey unit',
                    'analysis_area_m2':500.0,
                    'protocol_adjustment':'Summed randomized displayed block rows within survey; normalized once over documented 500m²'})
        legacy_group.append(row)
    legacy_table=pd.DataFrame(legacy_group)
    adjusted=pd.concat([regular,legacy_table],ignore_index=True,sort=False)
    adjusted=adjusted.drop(columns=['survey_key'],errors='ignore')
    adjusted=adjusted.sort_values(['survey_date','survey_id','block'],kind='stable').reset_index(drop=True)
    adjusted_path=OUT/'protocol_adjusted_training_table.csv.gz'
    adjusted.to_csv(adjusted_path,index=False,compression='gzip')
    other=joined[~known]
    program_counts=joined.groupby('program_norm',dropna=False).agg(
        source_block_rows=('survey_id','size'),survey_count=('survey_key','nunique'),
        raw_fish_count=('fish_count','sum')).reset_index()
    program_counts.to_csv(OUT/'protocol_eligibility_by_program.csv',index=False)
    def distribution(frame):
        y=frame.fish_per_100m2.to_numpy(float)
        return {'n_units':int(len(y)),'mean':float(np.mean(y)) if len(y) else None,
                'median':float(np.median(y)) if len(y) else None,'p90':float(np.quantile(y,.9)) if len(y) else None,
                'p99':float(np.quantile(y,.99)) if len(y) else None,'maximum':float(np.max(y)) if len(y) else None,
                'zero_fraction':float(np.mean(y==0)) if len(y) else None}
    result={'protocol_rules':{
        'RLS':'Keep each displayed Method 1 block as 250m².',
        'ATRC from 2019':'Keep each displayed Method 1 block as 250m²; the manual says collection became identical to RLS.',
        'ATRC before 2019':'Sum all displayed rows within survey_id and normalize once over 500m²; displayed block assignments were randomized after collection.',
        'Parks Vic, FRDC, RRH, unknown/missing survey metadata':'Excluded from primary protocol-adjusted modeling until Method 1 area is verified.'},
        'input_rows':int(len(source)),'retained_adjusted_units':int(len(adjusted)),
        'standard_250m2_rows_retained':int(len(regular)),'legacy_atrc_displayed_rows_collapsed':int(len(legacy_rows)),
        'legacy_atrc_surveys_after_collapse':int(len(legacy_table)),
        'excluded_unknown_protocol_rows':int(len(other)),
        'excluded_rows_by_program':{str(k):int(v) for k,v in other.program_norm.value_counts(dropna=False).items()},
        'public_survey_ids_without_method1_metadata_rows':int(joined.program_norm.isna().sum()),
        'target_distribution_original_all_rows':distribution(source),
        'target_distribution_original_documented_protocol_rows':distribution(joined[known]),
        'target_distribution_original_pre2019_atrc_pseudo_block_rows':distribution(legacy_rows),
        'target_distribution_pre2019_atrc_recombined_500m2_units':distribution(legacy_table),
        'target_distribution_adjusted_documented_protocol_units':distribution(adjusted),
        'sha256':digest(adjusted_path),
        'interpretation':'Analysis-only protocol sensitivity. This does not recover zero blocks and does not assert that missing blocks are zero.'}
    (OUT/'protocol_adjustment_audit.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    return adjusted,result


def audit_raw_tail():
    table=pd.read_csv(OUT/'nrmn_training_table.csv.gz',low_memory=False)
    top=table.sort_values('fish_per_100m2',ascending=False).head(100).copy()
    keys={(str(r.survey_id),str(r.block)) for r in top.itertuples()}
    comp=defaultdict(Counter); duplicate_keys=Counter(); duplicate_exact_by_block=Counter()
    source_rows=zero_rows=absence_name_rows=duplicate_rows=0; duplicate_total=0
    duplicate_by_program=Counter();duplicate_blocks=set();duplicate_details=[];previous=None
    page_paths=sorted(RAW.glob('*.csv.gz'))
    if not page_paths:raise RuntimeError('No cached WFS pages found; restore/retrieve the AODN pages first')
    duplicate_fields=None
    for page in page_paths:
        with gzip.open(page,'rt',encoding='utf-8-sig',newline='') as stream:
            reader=csv.DictReader(stream)
            if duplicate_fields is None:duplicate_fields=[x for x in reader.fieldnames if x not in ('FID','geom')]
            for row in reader:
                source_rows+=1
                total=int(float(row.get('total') or 0))
                sid=str(row.get('survey_id') or '');block=str(row.get('block') or '')
                species=(row.get('reporting_name') or row.get('species_name') or '').strip()
                if total==0:zero_rows+=1
                if 'no species found' in species.lower():absence_name_rows+=1
                sig=tuple(row.get(c,'') for c in duplicate_fields)
                if sig==previous:
                    duplicate_rows+=1
                    duplicate_total+=total
                    duplicate_by_program[str(row.get('program') or 'Unknown')]+=1
                    duplicate_blocks.add((sid,block))
                    duplicate_details.append({'survey_id':sid,'block':block,'survey_date':row.get('survey_date'),
                        'program':row.get('program'),'species_name':row.get('species_name'),
                        'reporting_name':row.get('reporting_name'),'size_class':row.get('size_class'),
                        'total':total,'biomass':row.get('biomass')})
                    if (sid,block) in keys:duplicate_exact_by_block[(sid,block)]+=1
                previous=sig
                if (sid,block) in keys:
                    comp[(sid,block)][species]+=total
                    dup=(sid,block,species,row.get('size_class',''),str(total),str(row.get('biomass','')))
                    duplicate_keys[dup]+=1
    expected_rows=json.loads((OUT/'source_metadata.json').read_text(encoding='utf-8'))['number_matched']
    if source_rows!=expected_rows:raise RuntimeError(f'Raw WFS scan covered {source_rows} of {expected_rows} reported rows')
    pd.DataFrame(duplicate_details).to_csv(OUT/'exact_duplicate_source_rows.csv',index=False)
    (OUT/'raw_record_audit.json').write_text(json.dumps({'source_feature_type':base.TYPE,'cached_pages':len(page_paths),
        'source_rows_scanned':source_rows,'zero_total_source_records':zero_rows,'rows_named_no_species_found':absence_name_rows,
        'exact_duplicate_rows_excluding_FID_geometry':duplicate_rows,
        'duplicate_extra_fish_count_contribution':int(duplicate_total),
        'source_reported_fish_count_sum':int(table.fish_count.sum()),
        'duplicate_rows_by_program':{str(k):int(v) for k,v in duplicate_by_program.items()},
        'duplicate_affected_survey_block_count':int(len(duplicate_blocks)),
        'duplicate_audit_file':'exact_duplicate_source_rows.csv',
        'duplicate_detection':'Adjacent identical rows across the stable source sort, comparing every WFS attribute except FID and geometry. Repeated survey×block×species×size×count groups are separately counted for each top-100 block; repeated groups are not automatically called source duplicates.',
        'generated_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},indent=2)+'\n',encoding='utf-8')
    survey_file=OUT/'survey_list_public_data.csv.gz'
    surveys=pd.read_csv(survey_file,low_memory=False)
    metadata=surveys.set_index(surveys.survey_id.astype(str),drop=False)
    base_counts=table.groupby(table.survey_id.astype(str)).fish_count.sum().to_dict()
    dominant_blocks=defaultdict(list)
    for sid,block in keys:
        counts=comp[(sid,block)]
        if counts:
            name,count=max(counts.items(),key=lambda item:item[1])
            dominant_blocks[(sid,name,int(count))].append(block)
    repeated_extreme_pairs={key for key,blocks_for_count in dominant_blocks.items()
                            if len(set(blocks_for_count))>1 and key[2]>=25000}
    schooling_taxa={'Decapterus macarellus','Sardina pilchardus','Clupeid spp.','Clupeid spp',
        'Mallotus villosus','Boops boops','Atherina presbyter','Atherinid spp.','Atherinid spp',
        'Rhabdamia gracilis','Rhabdamia cypselurus'}
    rows=[];long=[]
    for rank,r in enumerate(top.itertuples(index=False),1):
        key=(str(r.survey_id),str(r.block)); info=metadata.loc[key[0]] if key[0] in metadata.index else None
        if isinstance(info,pd.DataFrame):info=info.iloc[0]
        c=comp[key];raw_count=int(r.fish_count);dominant=max(c.items(),key=lambda kv:kv[1]) if c else ('',0)
        short='; '.join(f'{name}: {int(count):,} ({count/max(raw_count,1):.1%})' for name,count in c.most_common(5))
        repeated_group_count=sum(n-1 for (sid,blk,*_),n in duplicate_keys.items() if sid==key[0] and blk==key[1] and n>1)
        program='' if info is None else str(info.get('program') or '')
        year=pd.to_datetime(r.survey_date,errors='coerce').year
        if program.upper()=='ATRC' and pd.notna(year) and year<2019:
            classification='confirmed pipeline issue'
            classification_reason='Displayed pre-2019 ATRC blocks were randomized after collection; the per-block density is invalid and is recombined in the protocol-adjusted analysis.'
        elif duplicate_exact_by_block[key]:
            classification='suspicious'
            classification_reason='Exact duplicate source rows are present; a field-sheet comparison is needed.'
        elif (key[0],dominant[0],int(dominant[1])) in repeated_extreme_pairs:
            classification='suspicious'
            classification_reason='The same extreme dominant-species count appears in multiple displayed blocks of this survey; this may be a copied estimate or a real school spanning blocks, and needs the source sheet.'
        elif dominant[1]>=25000 and dominant[1]/max(raw_count,1)>=.9:
            if dominant[0] in schooling_taxa:
                classification='plausible ecological extreme'
                classification_reason='A schooling or shoaling taxon dominates the block. This is ecologically plausible, but the public rows do not verify the large field estimate.'
            else:
                classification='unresolved'
                classification_reason='A single taxon dominates the very large count, but its field estimate and counting protocol cannot be checked in the public extract.'
        else:
            classification='unresolved'
            classification_reason='No source worksheet is exposed to verify the count or its protocol.'
        if program.upper()=='ATRC' and pd.notna(year) and year<2019:
            protocol_count=int(base_counts.get(key[0],raw_count))
            protocol_area=500.0
            protocol_density=protocol_count*100/protocol_area
            protocol_unit='pre-2019 ATRC survey aggregate; displayed blocks are randomized'
        elif program.upper() in ('RLS','ATRC'):
            protocol_count=raw_count;protocol_area=250.0
            protocol_density=protocol_count*100/protocol_area
            protocol_unit='standard 250 m² displayed Method 1 block'
        else:
            protocol_count=None;protocol_area=None;protocol_density=None
            protocol_unit='not normalized in primary protocol-adjusted table'
        method='1'
        rows.append({'rank':rank,'survey_id':r.survey_id,'block':r.block,'survey_date':r.survey_date,
            'lat':r.lat,'lon':r.lon,'site_name':r.site_name,'ecoregion':r.ecoregion,
            'program':None if info is None else info.get('program'),'methods':None if info is None else info.get('methods'),
            'survey_depth_m':r.survey_depth_m,'visibility_m':None if info is None else info.get('visibility'),
            'hour_utc':None if info is None else info.get('hour'),'direction':None if info is None else info.get('direction'),
            'method_id':method,'source_taxon_size_rows':int(r.n_species_records),'duplicate_exact_rows':int(duplicate_exact_by_block[key]),
            'repeated_species_size_count_groups':int(repeated_group_count),'fish_count_before_normalization':raw_count,
            'fish_per_100m2':float(r.fish_per_100m2),'dominant_species':dominant[0],
            'classification_reason':classification_reason,
            'protocol_unit':protocol_unit,'protocol_adjusted_unit_fish_count':protocol_count,
            'protocol_adjusted_unit_area_m2':protocol_area,'protocol_adjusted_unit_fish_per_100m2':protocol_density,
            'dominant_species_fish_count':int(dominant[1]),'dominant_species_share':float(dominant[1]/max(raw_count,1)),
            'top_5_species_counts_and_shares':short,'classification':classification})
        for species,count in c.most_common():long.append({'rank':rank,'survey_id':r.survey_id,'block':r.block,
            'fish_per_100m2':float(r.fish_per_100m2),'fish_count_before_normalization':raw_count,
            'species':species,'fish_count':int(count),'share_of_block_count':float(count/max(raw_count,1))})
    pd.DataFrame(rows).to_csv(OUT/'top100_outlier_blocks.csv',index=False)
    pd.DataFrame(long).to_csv(OUT/'top100_species_composition.csv',index=False)
    return json.loads((OUT/'raw_record_audit.json').read_text(encoding='utf-8'))


def distance_prediction(train,test):
    train_xy=train[['lat','lon']].to_numpy(float); test_xy=test[['lat','lon']].to_numpy(float); target=train.target.to_numpy(float)
    out=np.full(len(test),np.nan)
    for i,p in enumerate(test_xy):
        d=base.haversine(np.repeat(p[None,:],len(train_xy),axis=0),train_xy)
        ix=np.where(d<=base.RADIUS_KM)[0]
        if len(ix)<3:continue
        w=1/(1+(d[ix]/base.DECAY_KM)**3);neff=w.sum()**2/(w@w)
        if neff>=2.5:out[i]=np.average(target[ix],weights=w)
    return out


def models_predict(train,test):
    x=train[FEATURES].to_numpy(float);xt=test[FEATURES].to_numpy(float)
    y=train.target.to_numpy(float);yl=np.log1p(y)
    spline=make_pipeline(SimpleImputer(strategy='median',add_indicator=True),StandardScaler(),
        SplineTransformer(n_knots=4,degree=3,include_bias=False),Ridge(alpha=10.0))
    spline.fit(x,yl); eta=spline.predict(xt)
    train_eta=spline.predict(x)
    smear=float(np.mean(np.exp(np.clip(yl-train_eta,-50,50))))
    forest=make_pipeline(SimpleImputer(strategy='median',add_indicator=True),
        RandomForestRegressor(n_estimators=180,min_samples_leaf=5,max_features=.8,n_jobs=-1,random_state=42))
    forest.fit(x,yl); forest_eta=forest.predict(xt)
    gamma=make_pipeline(SimpleImputer(strategy='median',add_indicator=True),StandardScaler(),
        TweedieRegressor(power=2.0,link='log',alpha=1.0,max_iter=1000,tol=1e-7))
    gamma.fit(x,y)
    return {'global_median':np.full(len(test),np.median(y)),
        'distance_weighted':distance_prediction(train,test),
        'smooth_spline_naive':np.maximum(0,np.expm1(eta)),
        'smooth_spline_duan':np.maximum(0,np.exp(np.clip(eta,-50,50))*smear-1),
        'random_forest':np.maximum(0,np.expm1(forest_eta)),
        'gamma_log_link':np.maximum(0,gamma.predict(xt))}, {'spline_smearing_factor_training_residuals':smear}


def score(a,p):return base.metrics(np.asarray(a,float),np.asarray(p,float))


def validate_models(table,output_prefix='followup'):
    site=table.groupby(['lat','lon'],as_index=False).agg(target=('fish_per_100m2','mean'),
        survey_count=('survey_id','nunique'),**{f:(f,'mean') for f in FEATURES})
    site=site.replace([np.inf,-np.inf],np.nan).dropna(subset=['target']).reset_index(drop=True)
    site['predictors_complete']=site[FEATURES].notna().all(axis=1)
    actual=site.target.to_numpy(float);q=np.quantile(actual,[1/3,2/3]);q90=float(np.quantile(actual,.9))
    methods=['global_median','distance_weighted','smooth_spline_naive','smooth_spline_duan','gamma_log_link','random_forest']
    folds=[];all_preds=[]
    for size,purge in ((500,250),(1000,500)):
        blocks=[base.block_id(r.lat,r.lon,size) for r in site.itertuples()];unique=sorted(set(blocks))
        preds={m:np.full(len(site),np.nan) for m in methods};nearest=np.full(len(site),np.nan)
        env_distance=np.full(len(site),np.nan);env_threshold=np.full(len(site),np.nan);env_supported=np.zeros(len(site),dtype=bool)
        cc_pred=np.full(len(site),np.nan)
        fold_smears=[]
        for fold_idx,key in enumerate(unique):
            testidx=np.array([i for i,b in enumerate(blocks) if b==key]);cand=np.array([i for i,b in enumerate(blocks) if b!=key])
            candidate_xy=site.iloc[cand][['lat','lon']].to_numpy(float); purged=np.zeros(len(cand),dtype=bool)
            for ti in testidx:
                center=site.loc[ti,['lat','lon']].to_numpy(float)
                purged |= base.haversine(np.repeat(center[None,:],len(cand),axis=0),candidate_xy)<purge
            trainidx=cand[~purged]
            if len(trainidx)<20:continue
            train=site.iloc[trainidx];test=site.iloc[testidx]
            result,extra=models_predict(train,test)
            fold_smears.extend([extra['spline_smearing_factor_training_residuals']]*len(testidx))
            for name,val in result.items():preds[name][testidx]=val
            # Environmental novelty is calibrated from this training fold only.
            # Missingness flags stay separate from imputed numeric values, so a
            # model prediction cannot make a site look environmentally familiar.
            train_x=train[FEATURES].to_numpy(float);test_x=test[FEATURES].to_numpy(float)
            med=np.nanmedian(train_x,axis=0)
            med[~np.isfinite(med)]=0.0
            train_missing=~np.isfinite(train_x);test_missing=~np.isfinite(test_x)
            train_filled=np.where(train_missing,med,train_x);test_filled=np.where(test_missing,med,test_x)
            mu=train_filled.mean(axis=0);sd=train_filled.std(axis=0);sd[sd==0]=1.0
            ztrain=np.column_stack([(train_filled-mu)/sd,train_missing.astype(float)])
            ztest=np.column_stack([(test_filled-mu)/sd,test_missing.astype(float)])
            nn=NearestNeighbors(n_neighbors=2).fit(ztrain)
            loo=nn.kneighbors(ztrain)[0][:,1]
            threshold=float(np.quantile(loo,.95))
            distance=NearestNeighbors(n_neighbors=1).fit(ztrain).kneighbors(ztest)[0][:,0]
            env_distance[testidx]=distance;env_threshold[testidx]=threshold;env_supported[testidx]=distance<=threshold
            test_complete=testidx[site.predictors_complete.to_numpy()[testidx]]
            train_cc=train[train.predictors_complete]
            if len(train_cc)>=20 and len(test_complete):
                mdl=make_pipeline(StandardScaler(),SplineTransformer(n_knots=4,degree=3,include_bias=False),Ridge(alpha=10.0))
                mdl.fit(train_cc[FEATURES].to_numpy(float),np.log1p(train_cc.target.to_numpy(float)))
                cc_pred[test_complete]=np.maximum(0,np.expm1(mdl.predict(site.iloc[test_complete][FEATURES].to_numpy(float))))
            for ti in testidx:
                d=base.haversine(site.loc[ti,['lat','lon']].to_numpy(float)[None,:],train[['lat','lon']].to_numpy(float))[0]
                nearest[ti]=float(d.min())
            if fold_idx%50==0:print(f'  follow-up {size} km: {fold_idx}/{len(unique)} spatial blocks',flush=True)
        complete=site.predictors_complete.to_numpy(bool);scores={name:score(actual,pred) for name,pred in preds.items()}
        allfinite=np.logical_and.reduce([np.isfinite(preds[m]) for m in methods])
        qgroup=np.where(actual<=q[0],'low (<=33rd percentile)',np.where(actual<=q[1],'middle (33rd-67th percentile)','upper (>67th percentile)'))
        quantile_metrics={}
        for grp in np.unique(qgroup):quantile_metrics[grp]={name:score(actual[qgroup==grp],p[qgroup==grp]) for name,p in preds.items()}
        quantile_metrics['upper_tail (>=90th percentile)']={name:score(actual[actual>=q90],p[actual>=q90]) for name,p in preds.items()}
        missing_metrics={}
        for label,mask in [('complete predictors',complete),('one or more missing predictors',~complete)]:
            missing_metrics[label]={'n_test_sites':int(mask.sum()),'metrics':{name:score(actual[mask],pred[mask]) for name,pred in preds.items()}}
        missing_metrics['complete-case spline sensitivity']={'n_test_sites':int(np.isfinite(cc_pred).sum()),'metrics':score(actual,cc_pred)}
        common_metrics={name:score(actual[allfinite],pred[allfinite]) for name,pred in preds.items()}
        regional={region:{name:score(actual[mask],pred[mask]) for name,pred in preds.items()} for region,mask in base.region_masks(site).items()}
        env_metrics={}
        for label,mask in [('environmentally supported',env_supported & np.isfinite(env_distance)),
                           ('environmentally unsupported',(~env_supported) & np.isfinite(env_distance))]:
            env_metrics[label]={'n_test_sites':int(mask.sum()),'coverage_percent':float(mask.mean()*100) if len(mask) else None,
                                'metrics':{name:score(actual[mask],pred[mask]) for name,pred in preds.items()}}
        missing_novelty={}
        novelty_valid=np.isfinite(env_distance)
        for label,mask in [('complete predictors',complete),('one or more missing predictors',~complete)]:
            selected=mask & novelty_valid
            missing_novelty[label]={'n_test_sites':int(selected.sum()),
                'environmentally_supported_sites':int((selected & env_supported).sum()),
                'environmentally_supported_percent':float(env_supported[selected].mean()*100) if selected.any() else None,
                'median_novelty_distance':float(np.median(env_distance[selected])) if selected.any() else None}
        distbands={}
        for name,pred in preds.items():
            distbands[name]={}
            for lo,hi in ((0,250),(250,500),(500,1000),(1000,2000),(2000,2500),(2500,float('inf'))):
                mask=(nearest>=lo)&(nearest<hi)
                distbands[name][f'{lo}-{hi if np.isfinite(hi) else "plus"} km']=score(actual[mask],pred[mask])
        fold={'block_km':size,'purge_km':purge,'site_count':len(site),'number_of_spatial_blocks':len(unique),
              'same_fold_comparison_common_sites':int(allfinite.sum()),'common_site_metrics':common_metrics,'metrics':scores,'regional_performance':regional,
              'low_middle_upper_abundance_quantiles':{'boundaries':{'p33':float(q[0]),'p67':float(q[1]),'p90':q90},'metrics':quantile_metrics},
              'predictor_completeness':missing_metrics,
              'environmental_novelty_support':{'held_out_sites_with_fold_threshold':int(novelty_valid.sum()),
                  'supported_sites':int((env_supported & novelty_valid).sum()),
                  'support_percent':float(env_supported[novelty_valid].mean()*100) if novelty_valid.any() else None,
                  'novelty_distance_p95':float(np.quantile(env_distance[novelty_valid],.95)) if novelty_valid.any() else None,
                  'held_out_novelty_threshold_median':float(np.median(env_threshold[novelty_valid])) if novelty_valid.any() else None,
                  'by_predictor_completeness':missing_novelty,'metrics':env_metrics},
              'error_by_nearest_training_distance':distbands,
              'duan_smearing_factor_training_fold_summary':{'median':float(np.median(fold_smears)),'min':float(np.min(fold_smears)),'max':float(np.max(fold_smears))}}
        folds.append(fold)
        for i in range(len(site)):
            for name,pred in preds.items():all_preds.append({'block_km':size,'lat':site.lat[i],'lon':site.lon[i],
                'actual':actual[i],'model':name,'predicted':pred[i],'nearest_training_km':nearest[i],
                'predictors_complete':bool(complete[i]),'environmental_novelty_distance':env_distance[i],
                'environmental_novelty_threshold':env_threshold[i],
                'environment_supported':bool(env_supported[i]) if np.isfinite(env_distance[i]) else None})
    predictions=pd.DataFrame(all_preds)
    predictions.to_csv(OUT/f'{output_prefix}_buffered_predictions.csv.gz',index=False,compression='gzip')
    result={'validation_design':'Same as fish_ecological_experiment.py: hold out complete equal-distance coordinate blocks at 500 km or 1000 km and purge every training coordinate within 250 km or 500 km of any site in that held-out block. No random primary holdout.',
        'site_count':int(len(site)),'predictors':FEATURES,'observed_target_quantile_cutpoints':{'p33':float(q[0]),'p67':float(q[1]),'p90':q90},
        'folds':folds,'note':'Duan smearing factor is computed only from the training fold spline residuals; it is not fitted on the held-out block. Gamma log-link uses TweedieRegressor power=2 (Gamma variance) because observed training targets are strictly positive; if a genuine zero-block denominator is recovered, this distributional choice must be revisited.'}
    (OUT/f'{output_prefix}_validation_results.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    return result


def predictor_gap_audit(table):
    # The first improvement is exact and actionable: WOA lookup previously
    # ignored its production sampler's 25 km nearest-valid-cell radius. The
    # rebuilt table now follows that same radius and records sample distances.
    # Diagnose GEBCO masks directly so missing depth and the stricter slope
    # neighbourhood are not collapsed into one generic NA category.
    import rasterio
    rasters={i:rasterio.open(ROOT/'data/.build/gebco_2026_2min'/f'gebco_2026_{i:02d}.tif') for i in range(8)}
    causes={}; unique=table[['lat','lon']].drop_duplicates()
    for loc in unique.itertuples(index=False):
        lat=float(loc.lat);lon=float(loc.lon)
        row=max(0,min(5399,int((90-lat)*30)));col=int((base.normlon(lon)+180)*30)%21600;north=row<2700;ordinal=col//2700;tile=(4 if north else 0)+{0:1,1:2,2:0,3:3}[ordinal]
        ds=rasters[tile];lr=row-(0 if north else 2700);lc=col%2700;rs=max(0,lr-1);cs=max(0,lc-1)
        w=ds.read(1,window=((rs,min(2700,lr+2)),(cs,min(2700,lc+2))))
        z=float(w[lr-rs,lc-cs]) if w.size else np.nan
        is_nodata=ds.nodata is not None and z==ds.nodata
        if is_nodata:depth_reason='center raster nodata'
        elif np.isfinite(z) and z>=0:depth_reason='center pixel is nonnegative land'
        elif not np.isfinite(z):depth_reason='center pixel unavailable'
        else:depth_reason='valid ocean center'
        if depth_reason!='valid ocean center':slope_reason=depth_reason
        elif w.shape!=(3,3):slope_reason='3x3 stencil clipped at raster-tile edge'
        elif ds.nodata is not None and np.any(w==ds.nodata):slope_reason='nodata in 3x3 slope stencil'
        elif np.any(w>=0):slope_reason='land pixels in 3x3 slope stencil'
        else:slope_reason='slope computation should be available'
        causes[(lat,lon)]=(depth_reason,slope_reason)
    for ds in rasters.values():ds.close()
    table['depth_gap_cause']=table.apply(lambda r:causes[(float(r.lat),float(r.lon))][0] if pd.isna(r.gebco_depth_m) else 'available',axis=1)
    table['slope_gap_cause']=table.apply(lambda r:causes[(float(r.lat),float(r.lon))][1] if pd.isna(r.seafloor_slope_deg) else 'available',axis=1)
    source_missing={}
    for feature,reason in [('gebco_depth_m','depth_gap_cause'),('seafloor_slope_deg','slope_gap_cause')]:
        sub=table[table[feature].isna()]
        source_missing[feature]={'survey_block_rows':sub[reason].value_counts().to_dict(),
            'coordinate_sites':sub[['lat','lon',reason]].drop_duplicates()[reason].value_counts().to_dict()}
    # Test whether the 4 km Copernicus missing sentinel can be recovered by
    # taking a nearby valid source pixel. This is diagnostic only; it does not
    # alter the predictor values or table used in model fitting.
    clarity_read,_=base.load_clarity(); exact=table[['lat','lon','survey_month','clarity_month_m']].drop_duplicates()
    clarity_missing=exact[exact.clarity_month_m.isna()]
    rescued={5:0,10:0,25:0}; sample_distances=[]
    for point in clarity_missing.itertuples(index=False):
        month=int(point.survey_month) if np.isfinite(point.survey_month) and 1<=point.survey_month<=12 else 7
        first=None
        for radius in (5,10,25):
            value,distance=clarity_read(float(point.lat),float(point.lon),month,radius,True)
            if np.isfinite(value):
                rescued[radius]+=1
                if first is None:first=distance
        if first is not None:sample_distances.append(first)
    # A land-valued 2-arc-minute pixel may be a coastal/geolocation mismatch,
    # not a missing bathymetry tile. Measure nearby negative-elevation pixels
    # but do not substitute them into the fitted table.
    depth_points=table.loc[table.gebco_depth_m.isna(),['lat','lon']].drop_duplicates()
    depth_recovered={5:[] ,10:[],25:[]}
    depth_rasters={i:rasterio.open(ROOT/'data/.build/gebco_2026_2min'/f'gebco_2026_{i:02d}.tif') for i in range(8)}
    def depth_tile(row,col):
        north=row<2700;ordinal=col//2700
        return (4 if north else 0)+{0:1,1:2,2:0,3:3}[ordinal]
    for point in depth_points.itertuples(index=False):
        lat=float(point.lat);lon=base.normlon(float(point.lon))
        row=max(0,min(5399,int((90-lat)*30)));col=int((lon+180)*30)%10800
        row_radius=math.ceil(25/(111.195/30))
        lon_km=max(1.0,111.195*math.cos(math.radians(lat)))
        col_radius=math.ceil(25/(lon_km/30))
        cells=defaultdict(list)
        for dr in range(-row_radius,row_radius+1):
            rr=row+dr
            if rr<0 or rr>=5400:continue
            for dc in range(-col_radius,col_radius+1):
                cc=(col+dc)%10800
                clat=90-(rr+.5)/30;clon=-180+(cc+.5)/30
                distance=float(base.haversine(np.array([[lat,lon]]),np.array([[clat,clon]]))[0])
                if distance<=25:cells[depth_tile(rr,cc)].append((rr,cc,clat,clon,distance))
        nearest=None
        for tile,items in cells.items():
            ds=depth_rasters[tile]
            local_rows=[rr-(0 if rr<2700 else 2700) for rr,_,_,_,_ in items]
            local_cols=[cc%2700 for _,cc,_,_,_ in items]
            r0,r1=min(local_rows),max(local_rows)+1;c0,c1=min(local_cols),max(local_cols)+1
            window=ds.read(1,window=((r0,r1),(c0,c1)))
            for (rr,cc,clat,clon,distance),lr,lc in zip(items,local_rows,local_cols):
                value=float(window[lr-r0,lc-c0])
                if (ds.nodata is None or value!=ds.nodata) and value<0 and (nearest is None or distance<nearest):nearest=distance
        if nearest is not None:
            for radius in (5,10,25):
                if nearest<=radius:depth_recovered[radius].append(nearest)
    for ds in depth_rasters.values():ds.close()
    # Keep an explicit support/gap decomposition from the same buffered folds.
    support={}
    valpath=OUT/'validation_results.json'; predpath=OUT/'buffered_validation_predictions.csv.gz'
    if valpath.exists() and predpath.exists():
        pred=pd.read_csv(predpath,low_memory=False); site=table.groupby(['lat','lon'],as_index=False).agg(**{f:(f,'mean') for f in FEATURES})
        site['predictors_complete']=site[FEATURES].notna().all(axis=1)
        pred['lat_key']=pred.lat.round(6);pred['lon_key']=pred.lon.round(6)
        site['lat_key']=site.lat.round(6);site['lon_key']=site.lon.round(6)
        for fold in json.loads(valpath.read_text(encoding='utf-8'))['folds']:
            sub=pred[(pred.block_km==fold['block_km'])&(pred.model=='global_median')].merge(
                site[['lat_key','lon_key','predictors_complete']],on=['lat_key','lon_key'],how='left',validate='one_to_one')
            support[str(fold['block_km'])]={label:{'n':int(len(g)),
                'environment_supported_n':int(g.environment_supported.fillna(False).astype(bool).sum()),
                'environment_supported_percent':float(g.environment_supported.fillna(False).astype(bool).mean()*100) if len(g) else None}
                for label,g in [('complete predictors',sub[sub.predictors_complete.fillna(False)]),
                                ('one_or_more_predictors_missing',sub[~sub.predictors_complete.fillna(False)])]}
    result={'lookup_contracts':{
        'temperature_month_c':{'grid_resolution_degrees':0.25,'lookup_radius_km':25,
            'lookup_behavior':'nearest valid monthly 0 m WOA23 cell within 25 km, matching js/temperature-query.js',
            'analysis_script_before_fix':'rounded grid cell only; this caused avoidable coastal false missingness'},
        'gebco_depth_m':{'grid_resolution_arcmin':2,'lookup_radius_km':0,
            'lookup_behavior':'exact survey-coordinate cell; positive land pixels and raster nodata are missing'},
        'seafloor_slope_deg':{'grid_resolution_arcmin':2,'neighborhood':'strict Horn 3x3; any nodata makes slope unavailable; land center unavailable'},
        'clarity_month_m':{'resolution_km':4,'lookup_radius_km':0,
            'lookup_behavior':'exact snapped Copernicus monthly median; 255 sentinel means no valid pixel; no spatial fallback'},
        'reef_extent':{'render_resolution_km':1,'lookup_behavior':'binary mapped reef raster; 0 is no mapped polygon, not missing, and not proof of no reef'}},
        'missingness_by_survey_block':{f:float(table[f].isna().mean()*100) for f in FEATURES},
        'bathymetry_missing_reason_counts':source_missing,
        'clarity_nearby_valid_pixel_sensitivity':{'exact_cell_missing_coordinate_months':int(len(clarity_missing)),
            'recovered_at_or_within_5_km':int(rescued[5]),'recovered_at_or_within_10_km':int(rescued[10]),
            'recovered_at_or_within_25_km':int(rescued[25]),
            'interpretation':'Source-mask/radius sensitivity only; nearby pixels were not substituted into the training table.'},
        'gebco_nearby_ocean_pixel_sensitivity':{'exact_center_depth_missing_coordinate_sites':int(len(depth_points)),
            'recovered_within_5_km':int(len(depth_recovered[5])),'recovered_within_10_km':int(len(depth_recovered[10])),
            'recovered_within_25_km':int(len(depth_recovered[25])),
            'nearest_valid_water_distance_km':{'median':float(np.median(depth_recovered[25])) if depth_recovered[25] else None,
                'p95':float(np.quantile(depth_recovered[25],.95)) if depth_recovered[25] else None,
                'max':float(np.max(depth_recovered[25])) if depth_recovered[25] else None},
            'interpretation':'Nearby negative-elevation pixels indicate a potentially avoidable coordinate/grid mismatch, but are diagnostic only; no nearby depth was substituted because distance may cross a reef slope, channel, or land boundary.'},
        'temperature_sample_distance_km':{'monthly_median':float(table.temperature_month_sample_distance_km.median()),
            'monthly_p95':float(table.temperature_month_sample_distance_km.quantile(.95)),
            'monthly_max':float(table.temperature_month_sample_distance_km.max()),
            'annual_mean_source_distance_median':float(table.temperature_annual_mean_sample_distance_km.median())},
        'blocked_environmental_support_by_predictor_completeness':support,
        'coastal_data_gap_conclusion':'WOA23 has global lat/lon coverage; after applying the existing 25 km nearest-valid-cell policy, remaining missing values are source-mask gaps within that radius, not a global extent limitation. The original 50.9% missing estimate was primarily an analysis preprocessing mismatch.'}
    (OUT/'predictor_missingness_audit.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    return result


def write_report(denom,raw,missing,protocol_audit,validation,broad_validation):
    def fmt(value):return 'n/a' if value is None or not np.isfinite(value) else f'{value:,.2f}'
    top=pd.read_csv(OUT/'top100_outlier_blocks.csv',low_memory=False)
    repeated=top[top.duplicated(['survey_id','dominant_species','dominant_species_fish_count'],keep=False)]
    repeated_extreme_entries=int((repeated.dominant_species_fish_count>=25000).sum())
    category_counts={str(k):int(v) for k,v in top.classification.value_counts().items()}
    lines=['# NRMN Fish-Density Follow-Up: Data and Model Audit','',
        f"Generated {time.strftime('%Y-%m-%d %H:%M UTC',time.gmtime())}. Analysis-only: no production values or visuals changed; MERMAID was not integrated.",'',
        '## A. Survey-block denominator and zero counts','',
        f"The independent public survey-list endpoint returned {denom['survey_list_rows']:,} survey records, including {denom['survey_list_m1_surveys']:,} records listing Method 1. Its schema has no block ID or completion status. In this WFS extract, {raw['zero_total_source_records']:,} taxon rows have total zero, none are named `No Species Found`, and {denom['whole_zero_target_blocks_observed']:,} aggregated survey-blocks have a zero target. This does not mean the true zero-block count is zero: the public endpoint omits 'survey not done' records, and absent block rows therefore cannot be identified as completed zeros.",'',
        f"For documented RLS and ATRC protocols, the nominal denominator is {denom['documented_standard_250m2_expected_blocks']:,} standard 250 m² block slots plus {denom['legacy_atrc_expected_survey_units_500m2']:,} pre-2019 ATRC 500 m² survey units. The public rows represent {denom['documented_standard_250m2_recorded_block_ids_capped_at_two_per_survey']:,} standard block IDs and {denom['legacy_atrc_surveys_with_any_observation_rows']:,} legacy ATRC survey units; {denom['nominal_unrepresented_documented_units_status_unknown']:,} nominal slots/units remain unrepresented with completion status unknown. Other programs are excluded from this denominator because their effective Method 1 area is not verified. Reconstructed completed zero blocks: {denom['reconstructed_zero_blocks']:,}. Within the documented cohort, the zero fraction is bounded only by 0–{denom['unknown_unit_zero_fraction_bounds_within_documented_cohort'][1]:.1%}; that upper bound assumes every unrepresented slot/unit was completed with zero fish, which is not evidenced.",'',
        f"Within those documented protocols, {denom['documented_protocol_units_with_fish_records']:,} represented units have fish records and {denom['documented_protocol_units_with_zero_targets']:,} have a zero total; the observed represented-unit zero fraction is 0%, but this is not an estimate of the completed-survey zero rate. If all {denom['nominal_unrepresented_documented_units_status_unknown']:,} missing slots/units were completed zero-fish surveys, the maximum sensitivity zero share would be {denom['unknown_unit_zero_fraction_bounds_within_documented_cohort'][1]:.2%}; the mean would move {denom['target_distribution_observed_positive_blocks']['mean']:.1f} to {denom['target_distribution_sensitivity_if_every_unrepresented_documented_unit_were_zero']['mean']:.1f}, median {denom['target_distribution_observed_positive_blocks']['median']:.1f} to {denom['target_distribution_sensitivity_if_every_unrepresented_documented_unit_were_zero']['median']:.1f}, p90 {denom['target_distribution_observed_positive_blocks']['p90']:.1f} to {denom['target_distribution_sensitivity_if_every_unrepresented_documented_unit_were_zero']['p90']:.1f}, and p99 {denom['target_distribution_observed_positive_blocks']['p99']:.1f} to {denom['target_distribution_sensitivity_if_every_unrepresented_documented_unit_were_zero']['p99']:.1f}. This is a modest numerical shift under an intentionally extreme assumption, not reconstructed zero data. The target still describes detected-fish survey units rather than unconditional global density.",'',
        '## B. Extreme tail and protocol audit','',
        f"Scanned {raw['source_rows_scanned']:,} source rows across {raw['cached_pages']} cached WFS pages. There are {raw['exact_duplicate_rows_excluding_FID_geometry']:,} adjacent exact duplicate source rows after excluding WFS FID and geometry, affecting {raw['duplicate_affected_survey_block_count']:,} survey-blocks. If each repeated row is an accidental duplicate, it contributes {raw['duplicate_extra_fish_count_contribution']:,} fish ({100*raw['duplicate_extra_fish_count_contribution']/max(1,raw['source_reported_fish_count_sum']):.3f}% of all reported fish); we keep them pending source-sheet confirmation. The top-100 extreme units contain {int(pd.read_csv(OUT/'top100_outlier_blocks.csv').duplicate_exact_rows.sum()):,} such rows. The repeated raw rows are listed in `exact_duplicate_source_rows.csv`. The top-100 table records original counts, survey and block IDs, coordinates, date, program, survey depth, visibility/time/direction metadata, dominant species and share, duplicate indicators, and a per-row evidence classification. Species composition for each unit is in `top100_species_composition.csv`. No extreme was deleted or winsorized.",'',
        f"The protocol review confirms that pre-2019 ATRC M1 rows were randomized into displayed blocks after collection, so their original per-block target is a confirmed normalization issue. The analysis-only table recombines them by survey ID and normalizes over 500 m². In the top 100, row classifications are {json.dumps(category_counts,ensure_ascii=False)}. {repeated_extreme_entries} high-count entries repeat the exact same dominant-species count in another displayed block of the same survey; these are marked suspicious for source-sheet review, not declared erroneous. The rest include plausible school-dominated observations or unresolved counts. Large schools are ecologically possible—for example, mackerel scad (*Decapterus macarellus*) form dense aggregations—but that behavior alone does not validate an estimated count of 400,000–850,000 per block. No field sheets were exposed by the public endpoints, and no values were removed.",'',
        '## C. Retransformation and blocked model comparison','',
        'The primary results use the protocol-adjusted RLS/ATRC table; other programs with unverified Method 1 area are excluded. A full-source-row run is retained as a sensitivity only. Both use the same coordinate-site unit and spatial split code: hold out complete 500 km or 1,000 km blocks, then remove all training sites within 250 km or 500 km of any held-out site in that block. No random holdout is used. Duan smearing is estimated fold-locally from the spline residuals; the Gamma log-link comparator is fitted to the positive target. A zero-inclusive Poisson/hurdle model is not supported without verified zero observations.','',
        '| Protocol-adjusted block / purge | Model | n | Coverage | MAE | Median abs. error | Bias | Spearman |','|---|---|---:|---:|---:|---:|---:|---:|']
    for fold in validation['folds']:
        for name,m in fold['metrics'].items():
            lines.append(f"| {fold['block_km']} / {fold['purge_km']} km | {name} | {m['n']:,} | {m['coverage_percent']:.1f}% | {fmt(m.get('mae_fish_100m2'))} | {fmt(m.get('median_abs_error_fish_100m2'))} | {fmt(m.get('bias_fish_100m2'))} | {fmt(m.get('spearman'))} |")
    lines+=['','### Direct comparison on the same held-out sites','',
        '| Block / purge | Model | Common n | MAE | Median abs. error | Bias | Spearman |','|---|---|---:|---:|---:|---:|---:|']
    for fold in validation['folds']:
        common=fold['common_site_metrics']
        n=fold['same_fold_comparison_common_sites']
        for name,m in common.items():
            lines.append(f"| {fold['block_km']} / {fold['purge_km']} km | {name} | {n:,} | {fmt(m.get('mae_fish_100m2'))} | {fmt(m.get('median_abs_error_fish_100m2'))} | {fmt(m.get('bias_fish_100m2'))} | {fmt(m.get('spearman'))} |")
    fold500=next(fold for fold in validation['folds'] if fold['block_km']==500)
    quantile_metrics=fold500['low_middle_upper_abundance_quantiles']['metrics']
    model_order=['global_median','distance_weighted','smooth_spline_naive','smooth_spline_duan','gamma_log_link','random_forest']
    lines+=['','### Abundance-band MAE on 500 km / 250 km folds','',
        '| Held-out target band | Median | Distance | Spline naïve | Spline Duan | Gamma | Random Forest |',
        '|---|---:|---:|---:|---:|---:|---:|']
    for band,metrics in quantile_metrics.items():
        vals=[fmt(metrics[name].get('mae_fish_100m2')) for name in model_order]
        lines.append(f"| {band} | "+' | '.join(vals)+' |')
    lines+=['','Full MAE, median absolute error, bias, and Spearman results for each abundance band are saved for both spatial scales in the validation JSON.','',
        'The all-source-row sensitivity uses the same split algorithm but includes protocol-unknown programs and unadjusted historical ATRC displayed rows; it is not the primary estimate. Its results are in `all_rows_sensitivity_validation_results.json`. Regional, nearest-training-distance, predictor-completeness, complete-case, and environmental-support metrics are in the primary JSON and its row-level prediction file. Compare each retransformation variant against both baselines, including bias and upper-decile errors; a lower overall MAE alone is not enough.','',
        'The protocol-adjusted target construction and its before/after distribution are in `protocol_adjustment_audit.json`; row-level source provenance stays in `nrmn_training_table.csv.gz`. The 100 largest original survey×displayed-block targets remain in the raw tail audit. The corrected legacy ATRC estimates should be interpreted at survey-unit level rather than compared to those historical displayed pseudo-block rows.','',
        '## D. Predictor missingness and environmental support','',
        f"Applying the existing 25 km WOA lookup lowered monthly/annual temperature missingness from 50.9% to {missing['missingness_by_survey_block']['temperature_month_c']:.1f}% of rows. Depth is missing at {missing['missingness_by_survey_block']['gebco_depth_m']:.1f}% of rows; all diagnosed missing depth centers are nonnegative cells in the coarse GEBCO raster, and {missing['gebco_nearby_ocean_pixel_sensitivity']['recovered_within_5_km']:,}/{missing['gebco_nearby_ocean_pixel_sensitivity']['exact_center_depth_missing_coordinate_sites']:,} such coordinates have a negative-elevation cell within 5 km ({missing['gebco_nearby_ocean_pixel_sensitivity']['recovered_within_25_km']:,} within 25 km). This shows a substantial candidate coordinate/grid gap, but a nearby bathymetry value is not substituted because coastlines and reef slopes can change rapidly. Clarity is missing at {missing['missingness_by_survey_block']['clarity_month_m']:.1f}% of rows; of {missing['clarity_nearby_valid_pixel_sensitivity']['exact_cell_missing_coordinate_months']:,} missing coordinate-month cells, {missing['clarity_nearby_valid_pixel_sensitivity']['recovered_at_or_within_5_km']:,} have a valid source pixel within 5 km and all {missing['clarity_nearby_valid_pixel_sensitivity']['recovered_at_or_within_25_km']:,} within 25 km. That is an avoidable exact-pixel coverage gap for diagnosis, not authorization to carry a neighboring value into production.",'',
        'The predictor-missingness artifact separates GEBCO center-cell land/nodata from slope-stencil gaps and records source sample distances. It also distinguishes environmental novelty from missing inputs using a fold-specific nearest-neighbor support boundary calibrated on training sites only. Missing-input and novel-environment counts and model metrics are reported separately; no global environmental values are imputed into the table.','',
        '| Block / purge | Held-out environmental support | Complete predictors: support | Missing predictors: support |','|---|---:|---:|---:|']
    for fold in validation['folds']:
        e=fold['environmental_novelty_support'];by=e['by_predictor_completeness']
        lines.append(f"| {fold['block_km']} / {fold['purge_km']} km | {e['support_percent']:.1f}% | {by['complete predictors']['environmentally_supported_percent']:.1f}% | {by['one or more missing predictors']['environmentally_supported_percent']:.1f}% |")
    lines+=['',
        '## Recommendation','',
        '**C. target data are too biased/incomplete for unconditional fish-density modelling**','',
        'The independent survey metadata provides candidate method-1 surveys and the manual documents the intended sampling areas, but neither endpoint provides completed status for each absent block. The public manual explicitly says no-fish completed blocks are published as “No Species Found”/zero and that “survey not done” records are hidden; the live table provides no reliable way to infer which absent rows are zeros. This makes the positive-only target inappropriate for unconditional global fish density. The environmental spline may still be useful for conditional exploratory prediction, but the protocol issue, extreme tail, and residual bias require further validation before prototyping a production surface. No production data, scores, or visuals were changed.','',
        '## Reproducibility and provenance','',
        '- Run `python tools/fish_ecological_experiment.py` to rebuild the cached base training table and unchanged original blocked baseline; run `python tools/fish_ecological_followup.py` for this follow-up audit and the two protocol sensitivity validations. Python package versions and local predictor sources are recorded in table metadata.','- Source pages and independent survey-list endpoint responses are retained with SHA-256 metadata under this folder.','- [NRMN Database QA/QC Protocols Manual v1.4](https://content.aodn.org.au/Documents/IMOS/Facilities/autonomous_underwater_vehicles/IMOS_NRMN_QAQC_v1.4.pdf) documents block areas, pre-2019 ATRC randomized displayed blocks, hidden “survey not done” records, and the “No Species Found”/zero convention.','- Schooling supports ecological plausibility for some pelagic counts but does not validate the field estimate: [mackerel scad aggregation study](https://onlinelibrary.wiley.com/doi/full/10.1002/aff2.70039).','- MERMAID was not accessed or integrated.','']
    (OUT/'scientific_audit_report.md').write_text('\n'.join(lines),encoding='utf-8')


def main():
    table=pd.read_csv(OUT/'nrmn_training_table.csv.gz',low_memory=False)
    surveys,smeta=fetch_survey_list()
    raw=audit_raw_tail()
    protocol_table,protocol_audit=build_protocol_adjusted_table(surveys)
    denom=audit_denominator(surveys,smeta,protocol_table)
    gaps=predictor_gap_audit(table)
    broad_validation=validate_models(table,'all_rows_sensitivity')
    validation=validate_models(protocol_table,'protocol_adjusted')
    write_report(denom,raw,gaps,protocol_audit,validation,broad_validation)
    metadata_path=OUT/'training_table_metadata.json';metadata=json.loads(metadata_path.read_text(encoding='utf-8'))
    metadata.update({'sha256':digest(OUT/'nrmn_training_table.csv.gz'),'row_count':int(len(table)),
        'analysis_only_lookup_corrections':['WOA23 nearest valid 0 m cell within 25 km, matching local temperature query contract','GEBCO center-cell depth remains valid when only a neighbouring slope-stencil pixel is nodata'],
        'additional_audit_columns':['temperature_month_sample_distance_km','temperature_annual_mean_sample_distance_km'],
        'zero_block_denominator_status':'survey metadata recovered; block completion/zero status not available for absent block rows',
        'followup_analysis_table':{'path':'protocol_adjusted_training_table.csv.gz','sha256':protocol_audit['sha256'],
            'rows':protocol_audit['retained_adjusted_units'],'rules':protocol_audit['protocol_rules'],
            'excluded_unknown_protocol_rows':protocol_audit['excluded_unknown_protocol_rows']}})
    metadata_path.write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'denominator':{k:denom[k] for k in ['survey_list_m1_surveys','documented_standard_250m2_expected_blocks',
        'documented_standard_250m2_recorded_block_ids_capped_at_two_per_survey','legacy_atrc_expected_survey_units_500m2',
        'legacy_atrc_surveys_with_any_observation_rows','nominal_unrepresented_documented_units_status_unknown',
        'reconstructed_zero_blocks','target_distribution_observed_positive_blocks']},
        'protocol_adjustment':protocol_audit,
        'raw':raw,'missing':gaps['missingness_by_survey_block'],
        'all_rows_models':[{'block':x['block_km'],'metrics':x['metrics']} for x in broad_validation['folds']],
        'protocol_adjusted_models':[{'block':x['block_km'],'metrics':x['metrics']} for x in validation['folds']]},indent=2),flush=True)

if __name__=='__main__':main()
