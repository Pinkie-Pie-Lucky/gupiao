import datetime as dt
import contextlib
import io
import json
import sys

import akshare as ak


def quiet_call(fn):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fn()


def number(value):
    try:
        result = float(value)
        return result if result == result else None
    except (TypeError, ValueError):
        return None


def latest_spot(symbol):
    for offset in range(0, 10):
        date = dt.date.today() - dt.timedelta(days=offset)
        if date.weekday() >= 5:
            continue
        try:
            frame = quiet_call(lambda: ak.futures_spot_price(date=date.strftime('%Y%m%d'), vars_list=[symbol]))
            if frame is None or frame.empty:
                continue
            row = frame.iloc[-1].to_dict()
            price = number(row.get('spot_price'))
            if price is not None:
                return {
                    'value': price,
                    'asOf': str(row.get('date') or date.strftime('%Y%m%d')),
                    'nearBasisRate': number(row.get('near_basis_rate')),
                    'dominantBasisRate': number(row.get('dom_basis_rate')),
                    'source': 'akshare_futures_spot_price_100ppi',
                }
        except Exception:
            continue
    return None


def latest_inventory(symbol):
    frame = quiet_call(lambda: ak.futures_inventory_em(symbol=symbol))
    if frame is None or frame.empty:
        return None
    row = frame.iloc[-1].to_dict()
    return {
        'value': number(row.get('库存')),
        'change': number(row.get('增减')),
        'asOf': str(row.get('日期')),
        'source': 'akshare_futures_inventory_em',
    }


def cpca_passenger_demand():
    wholesale = quiet_call(lambda: ak.car_market_total_cpca(symbol='狭义乘用车', indicator='批发'))
    fuel = quiet_call(lambda: ak.car_market_fuel_cpca(symbol='整体市场'))
    demand = []
    if wholesale is not None and not wholesale.empty:
        current_year = str(dt.date.today().year)
        previous_year = str(dt.date.today().year - 1)
        current_column = next((key for key in wholesale.columns if current_year in str(key)), None)
        previous_column = next((key for key in wholesale.columns if previous_year in str(key)), None)
        rows = wholesale.to_dict(orient='records')
        usable = [row for row in rows if current_column and number(row.get(current_column)) is not None]
        if usable:
            row = usable[-1]
            current = number(row.get(current_column))
            previous = number(row.get(previous_column)) if previous_column else None
            demand.append({
                'key': 'passenger_vehicle_wholesale', 'label': '狭义乘用车批发', 'category': 'demand', 'value': current,
                'unit': '万辆（乘联会表格口径）', 'asOf': f'{current_year}-{row.get("月份")}',
                'yoy': (current / previous - 1) if current is not None and previous not in (None, 0) else None,
                'source': 'akshare_cpca_total_wholesale',
            })
    if fuel is not None and not fuel.empty:
        usable = [row for row in fuel.to_dict(orient='records') if number(row.get('NEV')) is not None]
        if not usable:
            return demand
        row = usable[-1]
        month_key = next((key for key in row if '月' in str(key)), list(row.keys())[0])
        demand.append({
            'key': 'nev_sales_share', 'label': '新能源乘用车渗透率', 'category': 'demand', 'value': number(row.get('NEV')),
            'unit': '%', 'asOf': str(row.get(month_key)), 'source': 'akshare_cpca_fuel_market',
        })
    return demand


def build_chain(rule_id):
    fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()
    indicators = []
    gaps = []
    if rule_id == 'power_battery':
        spot = latest_spot('LC')
        if spot:
            indicators.append({'key': 'lithium_carbonate_spot', 'label': '碳酸锂现货价', 'category': 'price', 'value': spot['value'], 'unit': '元/吨', 'asOf': spot['asOf'], 'basisRate': spot['dominantBasisRate'], 'source': spot['source']})
        else:
            gaps.append('未取得碳酸锂现货价格。')
        try:
            inventory = latest_inventory('lc')
            if inventory:
                indicators.append({'key': 'lithium_carbonate_inventory', 'label': '碳酸锂期货库存', 'category': 'inventory', 'value': inventory['value'], 'change': inventory['change'], 'unit': '交易所披露单位（接口未返回单位标签）', 'asOf': inventory['asOf'], 'source': inventory['source']})
        except Exception as error:
            gaps.append(f'未取得碳酸锂库存：{str(error)[:120]}')
        gaps.append('乘联会乘用车产销接口存在间歇性解析失败，当前不作为稳定需求源；新能源车销量、装机量与储能招标仍待接入稳定序列。')
    elif rule_id == 'photovoltaic':
        spot = latest_spot('SI')
        if spot:
            indicators.append({'key': 'industrial_silicon_spot', 'label': '工业硅现货价', 'category': 'price', 'value': spot['value'], 'unit': '元/吨', 'asOf': spot['asOf'], 'basisRate': spot['dominantBasisRate'], 'source': spot['source']})
        else:
            gaps.append('未取得工业硅现货价格。')
        try:
            inventory = latest_inventory('si')
            if inventory:
                indicators.append({'key': 'industrial_silicon_inventory', 'label': '工业硅期货库存', 'category': 'inventory', 'value': inventory['value'], 'change': inventory['change'], 'unit': '交易所披露单位（接口未返回单位标签）', 'asOf': inventory['asOf'], 'source': inventory['source']})
        except Exception as error:
            gaps.append(f'未取得工业硅库存：{str(error)[:120]}')
        gaps.append('光伏新增装机、组件价格与产业链开工率尚未接入稳定公开序列。')
    else:
        gaps.append('该业务映射尚未找到可稳定调用且口径明确的公开价格、库存、产销或需求时间序列。')
    return {
        'ruleId': rule_id,
        'status': 'available' if indicators else 'unavailable',
        'indicators': indicators,
        'dataGaps': gaps,
        'sourceMeta': {'source': 'akshare_public_industry_chain', 'fetchedAt': fetched_at, 'freshness': 'delayed', 'confidence': 'market'},
    }


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise ValueError('rule_id is required')
    print(json.dumps(build_chain(sys.argv[1]), ensure_ascii=False))
