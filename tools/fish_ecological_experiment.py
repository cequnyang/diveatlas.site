#!/usr/bin/env python3
"""Reproducible, analysis-only NRMN ecological prediction experiment.

Downloads public AODN NRMN method-1 fish records, normalizes block counts to
fish/100 m2, joins local predictor grids and compares interpretable baselines
under the repository's buffered spatial-block split design. It never writes
production map assets. Run from any directory with the project Python runtime.
"""
from __future__ import annotations

import csv, gzip, io, json, math, time, hashlib
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
import requests
from PIL import Image
import PIL
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler, SplineTransformer
from sklearn.neighbors import NearestNeighbors
from sklearn.metrics import mean_absolute_error

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'analysis'/'fish-ecological-experiment'
RAW=OUT/'raw_pages'; OUT.mkdir(parents=True,exist_ok=True); RAW.mkdir(exist_ok=True)
WFS='https://geoserver-123.aodn.org.au/geoserver/ows'
TYPE='imos:ep_m1_public_data'; PAGE=10000; AREA_M2=250.0
RADIUS_KM=2500.0; DECAY_KM=250.0
FEATURES=['reef_extent','gebco_depth_m','seafloor_slope_deg','temperature_month_c','temperature_annual_c','clarity_month_m','lat']
EARTH=6371.0088

def normlon(x): return (x+180)%360-180
def haversine(a,b):
    p1=np.radians(a[:,0]);p2=np.radians(b[:,0]);dl=np.radians(((b[:,1]-a[:,1]+180)%360)-180);dp=p2-p1
    h=np.sin(dp/2)**2+np.cos(p1)*np.cos(p2)*np.sin(dl/2)**2
    return EARTH*2*np.arctan2(np.sqrt(h),np.sqrt(np.maximum(0,1-h)))

def recover_nrmn():
    """Stream WFS pages to disk and aggregate each survey transect block."""
    meta=OUT/'source_metadata.json'
    if meta.exists(): info=json.loads(meta.read_text())
    else:
        q={'service':'WFS','version':'2.0.0','request':'GetFeature','typeNames':TYPE,'resultType':'hits'}
        r=requests.get(WFS,params=q,timeout=120);r.raise_for_status()
        import xml.etree.ElementTree as ET
        info={'endpoint':WFS,'feature_type':TYPE,'number_matched':int(ET.fromstring(r.content).attrib['numberMatched']),
              'retrieved_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'page_size':PAGE,
              'sort_by':'survey_id,block,species_name,size_class,total,biomass,site_code,site_name'}
        meta.write_text(json.dumps(info,indent=2)+'\n')
    n=info['number_matched']; groups=defaultdict(lambda:{'count':0,'species_rows':0,'lat':None,'lon':None,'date':None,'depths':[],'region':None,'name':None})
    sort=info['sort_by']
    def download(start):
        page=RAW/f'{start:09d}.csv.gz'
        if page.exists():return start
        q={'service':'WFS','version':'2.0.0','request':'GetFeature','typeNames':TYPE,'count':PAGE,'startIndex':start,'outputFormat':'csv','sortBy':sort}
        r=requests.get(WFS,params=q,timeout=180);r.raise_for_status()
        if r.text.lstrip().startswith('<'): raise RuntimeError(f'WFS error at offset {start}: {r.text[:400]}')
        if not r.text.startswith('FID,') or len(r.content)<100: raise RuntimeError(f'Invalid/short CSV at offset {start}')
        temp=page.with_suffix('.tmp');temp.write_bytes(gzip.compress(r.content,compresslevel=6));temp.replace(page)
        return start
    starts=list(range(0,n,PAGE)); missing=[s for s in starts if not (RAW/f'{s:09d}.csv.gz').exists()]
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures=[pool.submit(download,s) for s in missing]
        for j,f in enumerate(as_completed(futures),1):
            s=f.result();print(f'downloaded page offset {s:,}; {j:,}/{len(missing):,} pending pages complete',flush=True)
    for start in starts:
        page=RAW/f'{start:09d}.csv.gz'
        page_records=0
        with gzip.open(page,'rt',encoding='utf-8-sig',newline='') as f:
            for r in csv.DictReader(f):
                page_records+=1
                sid=r.get('survey_id'); block=r.get('block')
                if not sid or not block: continue
                key=(sid,block);g=groups[key]
                try: g['count']+=int(float(r.get('total') or 0))
                except (ValueError,TypeError): pass
                g['species_rows']+=1
                for k,col in [('lat','latitude'),('lon','longitude'),('date','survey_date'),('region','ecoregion'),('name','site_name')]:
                    if g[k] is None and r.get(col):
                        try:g[k]=float(r[col]) if k in ('lat','lon') else r[col]
                        except ValueError:pass
                try:g['depths'].append(float(r['depth']))
                except (ValueError,TypeError,KeyError):pass
        expected=min(PAGE,n-start)
        if page_records!=expected:raise RuntimeError(f'WFS page {start} contains {page_records} rows, expected {expected}; refuse incomplete target table')
    rows=[]
    for (sid,block),g in groups.items():
        if g['lat'] is None or g['lon'] is None: continue
        rows.append({'survey_id':sid,'block':block,'lat':g['lat'],'lon':normlon(g['lon']),'survey_date':g['date'],
          'survey_month':int(str(g['date'])[5:7]) if g['date'] and len(str(g['date']))>=7 else np.nan,
          'fish_count':g['count'],'survey_area_m2':AREA_M2,'fish_per_100m2':g['count']*100/AREA_M2,
          'n_species_records':g['species_rows'],'survey_depth_m':float(np.median(g['depths'])) if g['depths'] else np.nan,
          'ecoregion':g['region'],'site_name':g['name']})
    df=pd.DataFrame(rows)
    df.to_csv(OUT/'nrmn_training_table.csv.gz',index=False,compression='gzip')
    info.update({'aggregated_survey_blocks':len(df),'density_formula':'sum(total individuals) per survey_id and block / 2.5 (250 m2 transect block scaled to 100 m2)',
      'target':'fish_per_100m2; sums all fish taxon/size records within a survey block; zero counts retained where explicitly represented'})
    meta.write_text(json.dumps(info,indent=2)+'\n')
    return df

def load_temperature():
    m=json.loads((ROOT/'data/temperature/query/metadata.json').read_text()); grid=m['grid']; enc=m['value_encoding']; cache={}
    def read(lat,lon,month,return_distance=False):
        row=int(round((lat-grid['latitude_first_center'])/grid['latitude_step_degrees'])); col=int(round((normlon(lon)-grid['longitude_first_center'])/grid['longitude_step_degrees']))%grid['longitude_count']
        if not (0<=row<grid['latitude_count']):return (np.nan,np.nan) if return_distance else np.nan
        nr=max(1,round(m['chunk_degrees']/grid['latitude_step_degrees']));nc=max(1,round(m['chunk_degrees']/grid['longitude_step_degrees'])); cr=row//nr;cc=col//nc
        key=(cr,cc)
        if key not in cache:
            halo=int(m['chunk_halo_cells']); row_start=max(0,cr*nr-halo); col_start=max(0,cc*nc-halo)
            rows=min(grid['latitude_count'],(cr+1)*nr+halo)-row_start
            cols=nc+2*halo
            desc={'row_start':row_start,'column_start':(cc*nc-halo)%grid['longitude_count'],'rows':rows,'columns':cols}
            p=ROOT/'data/temperature/query/chunks'/f'r{cr:02d}_c{cc:02d}.i16.gz'
            cache[key]=(np.frombuffer(gzip.open(p,'rb').read(),dtype='<i2').reshape(len(m['available_months'])*len(m['available_depths_m']),rows,cols),desc)
        v,desc=cache[key];mi=m['available_months'].index(month); di=m['available_depths_m'].index(0)
        # Match js/temperature-query.js: search the surrounding 3x3 cells and
        # use the nearest valid ocean value within 25 km. Sampling only the
        # rounded cell falsely marked many coastal survey coordinates missing.
        best=None
        for dr in (-1,0,1):
            candidate_row=row+dr
            if not (0<=candidate_row<grid['latitude_count']):continue
            candidate_lat=float(grid['latitude_first_center'])+candidate_row*float(grid['latitude_step_degrees'])
            for dc in (-1,0,1):
                candidate_col=(col+dc)%grid['longitude_count']
                candidate_lon=float(grid['longitude_first_center'])+candidate_col*float(grid['longitude_step_degrees'])
                distance=float(haversine(np.array([[lat,normlon(lon)]]),np.array([[candidate_lat,normlon(candidate_lon)]]))[0])
                if distance>25 or (best is not None and distance>=best[0]):continue
                ri=candidate_row-int(desc['row_start']);ci=(candidate_col-int(desc['column_start'])+grid['longitude_count'])%grid['longitude_count']
                if not (0<=ri<v.shape[1] and 0<=ci<v.shape[2]):continue
                stored=int(v[mi*len(m['available_depths_m'])+di,ri,ci])
                if stored==int(enc['missing_sentinel']):continue
                best=(distance,stored)
        if best is None:return (np.nan,np.nan) if return_distance else np.nan
        value=best[1]*float(enc['scale_c'])
        return (value,best[0]) if return_distance else value
    return read,m

def load_clarity():
    m=json.loads((ROOT/'data/water_clarity/metadata.json').read_text());grid=m['grid'];cache={}
    def read(lat,lon,month,maxDistanceKm=None,return_distance=False):
        row=int(round((lat-grid['latitude_first_center'])/grid['latitude_step_degrees']));col=int(round((normlon(lon)-grid['longitude_first_center'])/grid['longitude_step_degrees']))%grid['longitude_count']
        if row<0 or row>=grid['latitude_count']:return (np.nan,np.nan) if return_distance else np.nan
        core_rows=max(1,round(m['query']['chunk_degrees']/grid['latitude_step_degrees']));core_cols=max(1,round(m['query']['chunk_degrees']/grid['longitude_step_degrees']))
        radius=0 if maxDistanceKm is None else max(0,float(maxDistanceKm))
        row_radius=0 if radius==0 else math.ceil(radius/(110.574*grid['latitude_step_degrees']))
        lon_km=max(11.1,111.32*math.cos(math.radians(lat)));col_radius=0 if radius==0 else math.ceil(radius/(lon_km*grid['longitude_step_degrees']))
        candidates=[]
        for dr in range(-row_radius,row_radius+1):
            rr=row+dr
            if rr<0 or rr>=grid['latitude_count']:continue
            rlat=float(grid['latitude_first_center'])+rr*float(grid['latitude_step_degrees'])
            for dc in range(-col_radius,col_radius+1):
                cc=(col+dc)%grid['longitude_count'];clon=float(grid['longitude_first_center'])+cc*float(grid['longitude_step_degrees'])
                distance=float(haversine(np.array([[lat,normlon(lon)]]),np.array([[rlat,normlon(clon)]]))[0])
                if maxDistanceKm is None or distance<=radius:candidates.append((distance,rr,cc))
        candidates.sort(key=lambda item:item[0])
        for distance,rr,ccol in candidates:
            cr=rr//core_rows;chunk_col=ccol//core_cols;key=(cr,chunk_col)
            if key not in cache:
                desc=next((x for x in m['query']['chunks'] if int(x['row'])==cr and int(x['column'])==chunk_col),None)
                if desc is None:continue
                p=ROOT/'data/water_clarity/query/chunks'/desc['file']; a=np.frombuffer(gzip.open(p,'rb').read(),dtype=np.uint8).reshape(12,int(desc['rows']),int(desc['columns']));cache[key]=(a,desc)
            a,d=cache[key];v=int(a[month-1,rr-int(d['row_start']),ccol-int(d['column_start'])])
            if v==255:continue
            value=v*float(m['value_encoding']['scale_m'])
            return (value,distance) if return_distance else value
        return (np.nan,np.nan) if return_distance else np.nan
    return read,m

def reef_at(lat,lon,cache):
    # UNEP-WCMC rendered reef-extent tiles: alpha indicates mapped polygon.
    z=7;n=1<<z;lat=max(-85.05112878,min(85.05112878,lat));x=(normlon(lon)+180)/360*n;y=(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n;tx,ty=int(x),int(y)
    key=(z,tx,ty);p=ROOT/'data/reef_tiles'/str(z)/str(tx)/f'{ty}.png'
    if key not in cache:cache[key]=Image.open(p).convert('RGBA') if p.exists() else None
    im=cache[key]
    # The tile manifest contains only reef-bearing tiles; absent tiles represent
    # no mapped reef extent, not a missing-data cell.
    return float(im.getpixel((min(255,int((x-tx)*256)),min(255,int((y-ty)*256))))[3]>0) if im else 0.0

def terrain_at(lat,lon,datasets):
    # GEBCO tiles have 2700x2700 cells at 2 arc-minute spacing.
    row=max(0,min(5399,int((90-lat)*30)));col=int((normlon(lon)+180)*30)%21600; north=row<2700;ordinal=(col//2700);tile_id=(4 if north else 0)+{0:1,1:2,2:0,3:3}[ordinal]
    ds=datasets[tile_id];localrow=row-(0 if north else 2700); localcol=col%2700
    row_start=max(0,localrow-1);col_start=max(0,localcol-1)
    w=ds.read(1,window=((row_start,min(2700,localrow+2)),(col_start,min(2700,localcol+2))))
    if w.size==0:return np.nan,np.nan
    center_row=localrow-row_start;center_col=localcol-col_start
    z=float(w[center_row,center_col])
    if ds.nodata is not None and z==ds.nodata:return np.nan,np.nan
    # Do not treat island/land pixels in the coarse bathymetric grid as valid
    # seafloor elevation at a reef survey coordinate.
    if z>=0:return np.nan,np.nan
    # Depth is a centre-cell measurement; nearby land or nodata should prevent
    # a derivative calculation, not discard an otherwise valid ocean depth.
    if w.shape!=(3,3) or (ds.nodata is not None and np.any(w==ds.nodata)):return z,np.nan
    lat0=90-(row+.5)/30;dy=111195/30;dx=dy*math.cos(math.radians(lat0));a,b,c=w[0];d,_,f=w[1];g,h,i=w[2]
    gx=((c+2*f+i)-(a+2*d+g))/(8*dx);gy=((g+2*h+i)-(a+2*b+c))/(8*dy)
    return z,math.degrees(math.atan(math.hypot(gx,gy)))

def enrich(df):
    temp,tm=load_temperature();clar,cm=load_clarity(); reefs={}; datasets={i:rasterio.open(ROOT/'data/.build/gebco_2026_2min'/f'gebco_2026_{i:02d}.tif') for i in range(8)}
    vals=[]; predictor_cache={}
    for j,r in enumerate(df.itertuples(index=False)):
        month=int(r.survey_month) if np.isfinite(r.survey_month) and 1<=r.survey_month<=12 else 7
        cache_key=(round(float(r.lat),8),round(float(r.lon),8),month)
        if cache_key not in predictor_cache:
            depth,slope=terrain_at(r.lat,r.lon,datasets); tmon,tmon_dist=temp(r.lat,r.lon,month,True); ts=[temp(r.lat,r.lon,m,True) for m in range(1,13)]
            annual_values=[x[0] for x in ts if np.isfinite(x[0])]; annual_distances=[x[1] for x in ts if np.isfinite(x[0]) and np.isfinite(x[1])]
            predictor_cache[cache_key]=(reef_at(r.lat,r.lon,reefs),depth,slope,tmon,float(np.mean(annual_values)) if annual_values else np.nan,clar(r.lat,r.lon,month),tmon_dist,float(np.mean(annual_distances)) if annual_distances else np.nan)
        vals.append(predictor_cache[cache_key])
        if j and j%5000==0:print(f'joined predictors {j:,}/{len(df):,}',flush=True)
    a=np.asarray(vals,float)
    for col,name in enumerate(['reef_extent','gebco_depth_m','seafloor_slope_deg','temperature_month_c','temperature_annual_c','clarity_month_m','temperature_month_sample_distance_km','temperature_annual_mean_sample_distance_km']):df[name]=a[:,col]
    # Site-level modelling avoids repeated survey blocks at one coordinate leaking across folds.
    df.to_csv(OUT/'nrmn_training_table.csv.gz',index=False,compression='gzip')
    source={'predictors':[
      {'name':'reef_extent','source':'UNEP-WCMC WCMC-008 v4.1 local XYZ raster tiles','meaning':'mapped reef polygon at 1 km tile pixel; 1=inside, 0=no mapped polygon in tile (not proof of reef absence); spatial proxy only'},
      {'name':'gebco_depth_m','source':'GEBCO 2026 2-arc-minute local GeoTIFF','meaning':'negative elevation at survey coordinate converted to seafloor depth; nonnegative land pixels set missing'},
      {'name':'seafloor_slope_deg','source':'GEBCO 2026, derived Horn 3x3 gradient','meaning':'slope in degrees using latitude-adjusted horizontal cell spacing'},
      {'name':'temperature_month_c','source':'WOA23 1991-2020 surface (0m) monthly climatology, 0.25 degree','meaning':'survey-month climatological temperature; nearest valid cell within 25 km, matching js/temperature-query.js; source-cell distance is retained in the table'},
      {'name':'temperature_annual_c','source':'WOA23 1991-2020 monthly surface climatology','meaning':'mean of available month values, each nearest valid cell within 25 km; mean source-cell distance is retained in the table'},
      {'name':'clarity_month_m','source':'Copernicus Marine Ocean Colour ZSD 2016-2025 monthly median, ~4 km','meaning':'survey-month climatological Secchi depth; month-specific; not contemporaneous'}],
      'target_leakage_controls':'No fish/coral observations, NRMN biomass, survey total, or target-derived scores are predictors. NRMN measured depth retained as metadata only; GEBCO depth is the prediction covariate.',
      'caveats':'Reef tile is a rendered binary presence at 1 km and has edge/resampling uncertainty. Clarity climatology period postdates some NRMN surveys; it is a static predictor association and not a historical causal covariate.'}
    (OUT/'predictor_metadata.json').write_text(json.dumps(source,indent=2)+'\n')
    for d in datasets.values():d.close()
    return df

def fit_predict(train,test):
    X=train[FEATURES].to_numpy(float); Xt=test[FEATURES].to_numpy(float); y=np.log1p(train.target.to_numpy(float))
    models={
      'global_median':np.full(len(test),np.median(train.target)),
      'distance_weighted':None,
      'smooth_spline_ridge':make_pipeline(SimpleImputer(strategy='median',add_indicator=True),StandardScaler(),SplineTransformer(n_knots=4,degree=3,include_bias=False),Ridge(alpha=10.0)),
      'random_forest':make_pipeline(SimpleImputer(strategy='median',add_indicator=True),RandomForestRegressor(n_estimators=180,min_samples_leaf=5,max_features=.8,n_jobs=-1,random_state=42))}
    models['smooth_spline_ridge'].fit(X,y);models['random_forest'].fit(X,y)
    outputs={'global_median':models['global_median'],'smooth_spline_ridge':np.expm1(models['smooth_spline_ridge'].predict(Xt)),'random_forest':np.expm1(models['random_forest'].predict(Xt))}
    # Match current estimator: source points are coordinate-site means; support <=2,500 km.
    trxy=train[['lat','lon']].to_numpy(float);texy=test[['lat','lon']].to_numpy(float)
    for k,p in enumerate(texy):
      d=haversine(np.repeat(p[None,:],len(trxy),axis=0),trxy);ix=np.where(d<=RADIUS_KM)[0]
      if len(ix)>=3:
        w=1/(1+(d[ix]/DECAY_KM)**3);neff=w.sum()**2/(w@w)
        outputs.setdefault('distance_weighted',np.full(len(test),np.nan))[k]=np.average(train.target.to_numpy()[ix],weights=w) if neff>=2.5 else np.nan
    return {k:np.maximum(0,np.asarray(v,float)) for k,v in outputs.items()}

def novelty_matrix(train_x,test_x=None):
    """Scale numeric predictors and append explicit missingness flags."""
    imp=SimpleImputer(strategy='median');train_filled=imp.fit_transform(train_x)
    test_filled=train_filled if test_x is None else imp.transform(test_x)
    mean=train_filled.mean(axis=0);sd=train_filled.std(axis=0);sd[sd==0]=1
    train_z=(train_filled-mean)/sd;test_z=(test_filled-mean)/sd
    train_missing=np.isnan(train_x).astype(float);test_missing=train_missing if test_x is None else np.isnan(test_x).astype(float)
    return np.column_stack([train_z,train_missing]),np.column_stack([test_z,test_missing]),imp,mean,sd

def block_id(lat,lon,size):
    latstep=size/110.574;row=math.floor((lat+90)/latstep);mid=-90+(row+.5)*latstep;lonstep=min(360,size/max(.5,111.32*math.cos(math.radians(mid))));col=math.floor((normlon(lon)+180)/lonstep);return row,col

def rankcorr(a,b):
    if len(a)<=2:return None
    value=pd.Series(a).corr(pd.Series(b),method='spearman')
    return float(value) if np.isfinite(value) else None
def metrics(actual,pred):
    ok=np.isfinite(pred);a=np.asarray(actual)[ok];p=np.asarray(pred)[ok]
    if not len(a):return {'n':0,'coverage_percent':0}
    e=p-a
    return {'n':int(len(a)),'coverage_percent':float(100*len(a)/max(1,len(actual))),'mae_fish_100m2':float(np.mean(abs(e))),'median_abs_error_fish_100m2':float(np.median(abs(e))),'bias_fish_100m2':float(np.mean(e)),'spearman':rankcorr(a,p)}

def run_validation(df):
    # Repeated surveys are averaged only after raw-unit reconstruction; unique-coordinate site means are fold units.
    site=df.groupby(['lat','lon'],as_index=False).agg(target=('fish_per_100m2','mean'),survey_count=('survey_id','nunique'),**{f: (f,'mean') for f in FEATURES})
    site=site.replace([np.inf,-np.inf],np.nan).dropna(subset=['target']).reset_index(drop=True)
    actual=site.target.to_numpy();rows=[];all_preds=[]
    schemes=[(500,250),(1000,500)]
    for size,purge in schemes:
      blocks=[block_id(r.lat,r.lon,size) for r in site.itertuples()]; unique=sorted(set(blocks)); print(f'validation {size} km: {len(unique)} blocks',flush=True)
      pred_by={name:np.full(len(site),np.nan) for name in ['global_median','distance_weighted','smooth_spline_ridge','random_forest']}; nearest=np.full(len(site),np.nan)
      env_supported=np.zeros(len(site),dtype=bool);env_novelty=np.full(len(site),np.nan)
      for bi,key in enumerate(unique):
        testidx=np.array([i for i,b in enumerate(blocks) if b==key]); cand=np.array([i for i,b in enumerate(blocks) if b!=key])
        # Buffered purge is target-centred and matches repository implementation.
        test=site.iloc[testidx]; train_idx=[]
        # Conservative block-level purge: remove a source if it is inside the
        # half-block buffer of ANY test site in the held block. This is at least
        # as strict as the established target-centred purge and allows one fit
        # per fold instead of fitting once per coordinate.
        train_xy=site.iloc[cand][['lat','lon']].to_numpy(float)
        purged=np.zeros(len(cand),dtype=bool)
        for ti in testidx:
          p=site.loc[ti,['lat','lon']].to_numpy(float)
          purged |= haversine(np.repeat(p[None,:],len(cand),axis=0),train_xy)<purge
        train_idx=cand[~purged]
        if len(train_idx)<20:continue
        train_i=site.iloc[train_idx]
        result=fit_predict(train_i,test)
        for name,v in result.items():pred_by[name][testidx]=v
        ztrain,ztest,_,_,_=novelty_matrix(train_i[FEATURES].to_numpy(float),test[FEATURES].to_numpy(float))
        nn=NearestNeighbors(n_neighbors=2).fit(ztrain);td=nn.kneighbors(ztrain)[0][:,1];cut=float(np.quantile(td,.95));nov=NearestNeighbors(n_neighbors=1).fit(ztrain).kneighbors(ztest)[0][:,0]
        env_novelty[testidx]=nov;env_supported[testidx]=nov<=cut
        for ti in testidx:
          p=site.loc[ti,['lat','lon']].to_numpy(float);ds=haversine(p[None,:].repeat(len(train_i),axis=0),train_i[['lat','lon']].to_numpy(float));nearest[ti]=float(ds.min())
        if bi%20==0:print(f'  {bi}/{len(unique)} blocks complete',flush=True)
      regional={}
      for region,mask in region_masks(site).items():
        regional[region]={name:metrics(actual[mask],pred[mask]) for name,pred in pred_by.items()}
      by_distance={}
      for name,pred in pred_by.items():
        by_distance[name]={}
        for lo,hi in [(0,250),(250,500),(500,1000),(1000,2000),(2000,2500),(2500,float('inf'))]:
          m=(nearest>=lo)&(nearest<hi); by_distance[name][f'{lo}-{hi if np.isfinite(hi) else "plus"}km']=metrics(actual[m],pred[m])
      score={name:metrics(actual,pred) for name,pred in pred_by.items()}
      common=np.logical_and.reduce([np.isfinite(p) for p in pred_by.values()]);common_metrics={name:metrics(actual[common],pred[common]) for name,pred in pred_by.items()}
      supported=np.isfinite(env_novelty)&env_supported
      rows.append({'block_km':size,'purge_km':purge,'n_sites':len(site),'score_by_model':score,'same_sites_direct_comparison':{'common_n':int(common.sum()),'metrics':common_metrics},'environmental_support':{'supported_sites':int(supported.sum()),'test_sites':int(np.isfinite(env_novelty).sum()),'coverage_percent':100*float(supported.sum())/max(1,int(np.isfinite(env_novelty).sum())),'supported_metrics_by_model':{name:metrics(actual[supported],pred[supported]) for name,pred in pred_by.items()}},'regional':regional,'error_by_nearest_training_distance':by_distance})
      for i in range(len(site)):
        for name,pred in pred_by.items():all_preds.append({'block_km':size,'lat':site.lat[i],'lon':site.lon[i],'actual':actual[i],'model':name,'predicted':pred[i],'nearest_training_km':nearest[i],'environment_supported':bool(env_supported[i]),'environmental_novelty':env_novelty[i]})
    # Environmental novelty from training distribution: standardized nearest-neighbor distance,
    # calibrated on leave-one-out distances within the complete model training set.
    X=site[FEATURES].to_numpy(float);Z,_,imp,mu,scale=novelty_matrix(X)
    nn=NearestNeighbors(n_neighbors=2).fit(Z);dist,_=nn.kneighbors(Z);threshold=float(np.quantile(dist[:,1],.95));site['environmental_novelty']=dist[:,1];site['environment_supported']=site.environmental_novelty<=threshold
    (OUT/'environment_support_reference.json').write_text(json.dumps({'predictors':FEATURES,'imputation_medians':imp.statistics_.tolist(),'standardization_mean':mu.tolist(),'standardization_sd':scale.tolist(),'missingness_indicators':[f'{name}_missing' for name in FEATURES],'unsupported_rule':'Impute numeric values with the saved training medians, standardize with saved means/SDs, append 0/1 missingness indicators in predictor order, then compute nearest NRMN training-site Euclidean distance. Mark target cells unsupported beyond the 95th percentile of training leave-one-out nearest-neighbor distances. Do not emit a model value as supported beyond this threshold.','training_loo_novelty_p95':threshold,'note':'Heuristic environmental novelty boundary; not a calibrated uncertainty interval.'},indent=2)+'\n')
    pd.DataFrame(all_preds).to_csv(OUT/'buffered_validation_predictions.csv.gz',index=False,compression='gzip')
    target=df.fish_per_100m2.to_numpy(float)
    result={'validation_design':'For each unique coordinate site, withhold its size-specific equal-distance block; purge all candidate training coordinate sites within half the block size of ANY site in that held-out block. This union purge is more conservative than the established per-target buffer. 500 km blocks/250 km purge and 1000 km blocks/500 km purge.','site_count':len(site),'features':FEATURES,'target_distribution':{'n_survey_blocks':len(target),'zero_fraction':float(np.mean(target==0)),'mean_fish_per_100m2':float(np.mean(target)),'median_fish_per_100m2':float(np.median(target)),'p90_fish_per_100m2':float(np.quantile(target,.9)),'p99_fish_per_100m2':float(np.quantile(target,.99)),'maximum_fish_per_100m2':float(np.max(target)),'skewness':float(pd.Series(target).skew())},'predictor_missing_percent':{f:float(df[f].isna().mean()*100) for f in FEATURES},'transform':'log1p target fit; predictions inverse-transformed and clipped to nonnegative fish/100 m2. Distance baseline remains raw arithmetic weighted mean, as in current production estimator.','environmental_support':{'heuristic':'standardized Euclidean nearest-neighbor distance with explicit missingness indicators; cutoff is 95th percentile of within-training leave-one-out nearest distances','threshold':threshold,'supported_site_count':int(site.environment_supported.sum()),'unsupported_site_count':int((~site.environment_supported).sum()),'note':'This is a novelty screen, not calibrated prediction uncertainty. Validation report separates prediction metrics from support coverage.'},'folds':rows}
    (OUT/'validation_results.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    return result

def write_report(df,result):
    def f(v):return 'n/a' if v is None or not np.isfinite(v) else f'{v:.3f}'
    lines=['# NRMN fish-density ecological prediction experiment','',f"Generated {time.strftime('%Y-%m-%d %H:%M UTC',time.gmtime())}. Analysis-only; production values and visuals were not changed.",'',
      '## Data recovery and target','',f"AODN WFS feature type `{TYPE}` returned {json.loads((OUT/'source_metadata.json').read_text())['number_matched']:,} source taxon records. Records are summed by `survey_id × block`; each block is 250 m² under the NRMN Method 1 50 m × 5 m transect design, then scaled to fish/100 m². This yielded {len(df):,} survey-block rows and {result['site_count']:,} exact-coordinate modelling units after averaging repeated surveys. The bundled production snapshot is an older extract, so results use the retrieved WFS vintage, recorded in `source_metadata.json`.",'',
      'The target is strongly right-skewed (survey-block skewness '+f(result['target_distribution']['skewness'])+'); the fitted ecological models therefore use `log1p(fish/100 m²)` and back-transform with `expm1`, clipping only negative numerical predictions to zero. The maximum is '+f(result['target_distribution']['maximum_fish_per_100m2'])+' fish/100 m², far above the p99 ('+f(result['target_distribution']['p99_fish_per_100m2'])+'). No values were removed because there is no independent protocol evidence to classify these high-count schools as erroneous; this extreme tail limits raw-unit MAE interpretation. No survey-block aggregate has a reported zero count; the feed may omit blocks with no fish encounters, so this experiment cannot validate unconditional abundance or occurrence. Metrics below are reported in fish/100 m². The distance estimator and global-median benchmark are computed in original target units.','',
      '## Predictors and leakage controls','', '| Predictor | Definition/source | Missing survey rows |','|---|---|---:|']
    labels={'reef_extent':'UNEP-WCMC WCMC-008 v4.1 local z7 raster alpha at survey pixel (binary mapped reef presence; ~1 km rendered resolution; no mapped polygon is not proof of no reef)','gebco_depth_m':'GEBCO 2026 2-arc-minute negative elevation at survey coordinate; nonnegative land pixels are missing','seafloor_slope_deg':'Horn 3×3 slope derived from GEBCO; latitude-adjusted cell spacing','temperature_month_c':'WOA23 1991–2020 surface climatology for survey month (July fallback when survey month missing)','temperature_annual_c':'Mean of available WOA23 monthly surface climatologies','clarity_month_m':'Copernicus ZSD monthly median (2016–2025), survey month','lat':'Survey latitude in degrees; included to capture broad biogeographic gradients'}
    for name in FEATURES:
      label=labels.get(name,'')
      lines.append(f"| `{name}` | {label} | {result['predictor_missing_percent'].get(name,0):.1f}% |")
    lines+=['','No fish counts, coral records, NRMN biomass, or fish-derived scores are predictors. NRMN measured depth is retained only as metadata; GEBCO depth is the model feature. Temperature and clarity are climatological proxies, not survey-date conditions; clarity’s climatology postdates some fish surveys. Reef extent uses a raster tile at its rendered resolution and edge cells are uncertain. See `predictor_metadata.json` for full provenance.','',
      '## Buffered spatial validation','',result['validation_design'],'', 'The two ecological models are a cubic spline additive ridge model (smooth GAM-like baseline) and a 180-tree Random Forest. Folds hold out complete 500 km or 1,000 km blocks. The union purge excludes any training site within 250 km or 500 km, respectively, of any test site in that block; this is conservative relative to the existing target-centred purge. No random split is used. Distance-only predictions use `1 / (1 + (d/250)^3)`, at most 2,500 km, minimum 3 coordinate sites and Kish effective sample size 2.5.','',
      '| Block / purge | Model | Sites predicted | Coverage | MAE | Median abs. error | Bias | Spearman |','|---|---|---:|---:|---:|---:|---:|---:|']
    for fold in result['folds']:
      for name,m in fold['score_by_model'].items():
        lines.append(f"| {fold['block_km']} km / {fold['purge_km']} km | {name} | {m['n']:,} | {m['coverage_percent']:.1f}% | {f(m.get('mae_fish_100m2'))} | {f(m.get('median_abs_error_fish_100m2'))} | {f(m.get('bias_fish_100m2'))} | {f(m.get('spearman'))} |")
    lines+=['','### Direct comparison on the same held-out sites','', '| Block | Common sites | Model | MAE | Median abs. error | Bias | Spearman |','|---:|---:|---|---:|---:|---:|---:|']
    for fold in result['folds']:
      for name,m in fold['same_sites_direct_comparison']['metrics'].items():
        lines.append(f"| {fold['block_km']} km | {fold['same_sites_direct_comparison']['common_n']:,} | {name} | {f(m.get('mae_fish_100m2'))} | {f(m.get('median_abs_error_fish_100m2'))} | {f(m.get('bias_fish_100m2'))} | {f(m.get('spearman'))} |")
    lines+=['','### Regional performance','', '| Block | Region | Model | n | MAE | Bias | Spearman |','|---:|---|---|---:|---:|---:|---:|']
    for fold in result['folds']:
      for region,models in fold['regional'].items():
        for name,m in models.items():
          if m['n']:lines.append(f"| {fold['block_km']} km | {region} | {name} | {m['n']:,} | {f(m.get('mae_fish_100m2'))} | {f(m.get('bias_fish_100m2'))} | {f(m.get('spearman'))} |")
    lines+=['','### Error versus distance and environmental support','', 'Full model-by-distance error bands are in `validation_results.json` and row-level predictions in `buffered_validation_predictions.csv.gz`. Nearest-source distance is measured after the block/purge exclusions. Each blocked fold estimates its environmental novelty boundary from training sites only. Novelty distance uses standardized environmental predictors plus explicit missingness flags. Target cells beyond the 95th percentile of training leave-one-out nearest-neighbor distance are flagged unsupported, even if a model emits a number. The reusable predictor order, imputation values, scaling, and cutoff are in `environment_support_reference.json`. This is a novelty screen, not calibrated uncertainty.','']
    for fold in result['folds']:
      e=fold['environmental_support'];lines.append(f"- {fold['block_km']} km blocks: environmental support for {e['supported_sites']:,}/{e['test_sites']:,} test sites ({e['coverage_percent']:.1f}%).")
    lines+=['','## Recommendation','']
    # A material win requires repeatable >10% MAE gain over both comparators on common support at both scales.
    eco=['smooth_spline_ridge','random_forest'];wins=[]
    for fold in result['folds']:
      ms=fold['same_sites_direct_comparison']['metrics'];wins.append(any(ms[e]['mae_fish_100m2'] is not None and all(ms[e]['mae_fish_100m2']<=.9*ms[b]['mae_fish_100m2'] for b in ['global_median','distance_weighted'] if ms[b]['mae_fish_100m2'] is not None) for e in eco))
    if len(wins)==2 and all(wins) and min(fold['environmental_support']['coverage_percent'] for fold in result['folds'])>=80 and max(abs(fold['same_sites_direct_comparison']['metrics']['smooth_spline_ridge']['bias_fish_100m2']) for fold in result['folds'])<100: decision='A. ecological model clearly improves generalization'
    elif any(wins) or all(result['folds'][i]['same_sites_direct_comparison']['metrics']['smooth_spline_ridge']['mae_fish_100m2']<.95*result['folds'][i]['same_sites_direct_comparison']['metrics']['global_median']['mae_fish_100m2'] for i in range(len(result['folds']))):decision='B. modest improvement, more work needed'
    elif len(df)<50000 or max(result['predictor_missing_percent'].values())>50:decision='D. raw data or predictors are insufficient'
    else:decision='C. no meaningful improvement over baseline/interpolation'
    lines += [f'**{decision}**','', 'This is an analysis recommendation only. MERMAID was not queried or integrated. If future validation supports an ecological model, production should separately label observed, locally interpolated, ecological-modelled, and unknown cells, with novelty-screen failures remaining unknown rather than displaying extrapolated scores.','', '## Source references','', '- [AODN/IMOS Global reef fish abundance and biomass dataset](https://researchdata.edu.au/imos-national-reef-abundance-biomass/1792107) (CC BY 4.0; use the dataset citation and protocol documentation in downstream publication).','- [GEBCO_2026 Grid](https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid).','- [Copernicus Marine Ocean Colour Product User Manual](https://documentation.marine.copernicus.eu/PUM/CMEMS-OC-PUM.pdf), which defines ZSD as Secchi disk depth in metres. WOA23 source metadata and the exact local file generations are recorded in the project predictor metadata.','']
    (OUT/'validation_report.md').write_text('\n'.join(lines),encoding='utf-8')

def region_masks(site):
    # Broad, deterministic reporting regions aligned to the project's existing screening windows.
    lat=site.lat.to_numpy();lon=site.lon.to_numpy();out={'Coral Triangle':(lat>=-12)&(lat<=20)&(lon>=95)&(lon<=141),'Caribbean':(lat>=5)&(lat<=30)&(lon>=-100)&(lon<=-55),'Indian Ocean':(lat>=-35)&(lat<=25)&(lon>=45)&(lon<=100),'Pacific':(lat>=-30)&(lat<=30)&((lon>=140)|(lon<=-100)),'Other':np.ones(len(site),bool)}
    claimed=np.zeros(len(site),bool)
    for k in list(out)[:-1]:out[k]&=~claimed;claimed|=out[k]
    out['Other']=~claimed
    return out

def main():
    df=recover_nrmn();print('NRMN transect blocks',len(df),flush=True);df=enrich(df);print('predictors joined',flush=True);result=run_validation(df)
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    source=json.loads((OUT/'source_metadata.json').read_text())
    page_rows=[{'start_index':int(p.name.split('.')[0]),'file':p.name,'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(RAW.glob('*.csv.gz'))]
    (OUT/'raw_page_manifest.json').write_text(json.dumps({'endpoint':WFS,'feature_type':TYPE,'record_count':source['number_matched'],'page_count':len(page_rows),'pages':page_rows},indent=2)+'\n')
    (OUT/'training_table_metadata.json').write_text(json.dumps({'table':'nrmn_training_table.csv.gz','sha256':digest(OUT/'nrmn_training_table.csv.gz'),'row_count':len(df),'coordinate_sites':int(df[['lat','lon']].drop_duplicates().shape[0]),'target':'fish_per_100m2','license':'CC BY 4.0 per AODN dataset metadata','sources':['AODN NRMN public WFS','local UNEP-WCMC WCMC-008 v4.1','GEBCO 2026','WOA23 1991-2020','Copernicus Marine ZSD 2016-2025'],'python_packages':{'numpy':np.__version__,'pandas':pd.__version__,'scikit_learn':'1.6.1','scipy':'1.15.2','rasterio':rasterio.__version__,'requests':requests.__version__,'Pillow':PIL.__version__}},indent=2)+'\n')
    write_report(df,result)
    print(json.dumps(result['folds'],indent=2)[:12000],flush=True)
if __name__=='__main__':main()
