#!/usr/bin/env python
# coding=utf-8

import re
import httplib2
import time
import sys
import json

# Try MAX_GET times before declare crawling web fail
MAX_GET = 3  

def dbg(fmtstr,*args):
    print >>sys.stderr,fmtstr.format(*args),

def get_estimate_price(stock_code,sleeptime=None):
    """Return the estimate price,using yesterday's starting quote
    wait sleeptime if not None to avoid push server too hard"""

    # Sina's stock query api
    url = None
    if stock_code.startswith("6"):
        url = "http://hq.sinajs.cn/list=sh" + stock_code
    elif stock_code.startswith("0"):
        url = "http://hq.sinajs.cn/list=sz" + stock_code
    else:
        assert(False)
    
    http = httplib2.Http(timeout=5)
    for i in range(MAX_GET):
        dbg("Get %s" % url)
        try:
            if sleeptime:
                time.sleep(sleeptime)
            response, content = http.request(url,"GET")
        except Exception as e:
            dbg("Fail:%s\n" % e)
            time.sleep(1)
        else:
            if response['status'] == "200":
                try:
                    r = float(content.split(",")[1])
                    dbg("Success\n")
                    return r
                except:
                    dbg("Fail:decode error:%s\n" % content)
                    return None
            else:
                dbg("Fail:status error:%s\n" % response['status'])
    return None
    

def build_name_list():
    """Return Chinese A share name list: 
    [[name1,code1],[name2,code2]...],
    or None if web crawling fail."""
    
    # Crawl web's data
    urls = [
        # Chinese A Shares in ShangHai
        "http://app.finance.ifeng.com/hq/list.php?type=stock_a&class=ha",
        # Chinese A Shares in ShenZhen
        "http://app.finance.ifeng.com/hq/list.php?type=stock_a&class=sa",
    ]

    http = httplib2.Http()

    names = []
    for url in urls:
        for i in range(MAX_GET):
            response, content = http.request(url,"GET")
            if response['status'] == "200":
                names.extend(re.findall(">([^\>\d]+)\((\d+)\)",content))
                break
        else:
            # Crawl fail
            return None

    # add price estimate
    names2 = [(name,code,get_estimate_price(code,None)) for name,code in names]
            
    return names2
            
def print_names_as_json(names):
    
    names = [(name,code,price) for (name,code,price) in names
             if name and code and price is not None]
    print "["
    last_i = len(names)-1
    for i,(name,code,price) in zip(range(len(names)),names):
        print '["%s","%s",%s]' % (name,code,price),
        if i != last_i:
            print ","
        else:
            print
    print "]"

def main():
                    
    nl = build_name_list()

    # sanity check
    nl2 = [(name,code) for (name,code,price) in nl]
    assert(len(nl) > 2000 and
           ("广发证券","000776") in nl2 and
           ("民生银行","600016") in nl2)
    
    print_names_as_json(nl)

    dbg("Build stock db done\n")

if __name__ == "__main__":
    main()

