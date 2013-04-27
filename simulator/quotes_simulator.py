# coding=utf-8

import json
import time
import random
from datetime import datetime

class Struct:
    """Anonymous struct"""
    def __init__(self,**entries):
        self.__dict__.update(entries)
        
    def __repr__(self):
        return json.dumps(vars(self))

        
def load_stock_db(db_file="stock_db.json"):
    """Return a list of stock object"""
    with open(db_file) as f:
        stock_db = json.load(f)
        return [Struct(
            time=datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            name=name,code=code,
            start_price=start_price,price=start_price,
            lowest=start_price, highest=start_price,
            volume=0)
                for (name,code,start_price) in stock_db if start_price >= 0.01]

def gen_quotes(db,i=-1):
    """Randomly generate a quote,
    if i>=0,generate db[i]'s quotes,
    else generate a random stock's quotes"""

    if i<0:
        i = random.randint(0,len(db)-1)
    x = db[i]

    # New price change is based on last one, a random walk process
    # keep change within 1%
    change = (random.random()-0.5)*0.01
    x.price = float("%.2f" % (x.price*(1+change)))
    
    # In Chinese stock market, change must be within +-10%
    if x.price < x.start_price * 0.9:
        x.price = x.start_price * 0.9
    elif x.price > x.start_price * 1.1:
        x.price = x.start_price * 1.1
        
    x.lowest = min(x.price,x.lowest)
    x.highest = max(x.price,x.highest)
    x.volume = random.randint(1000,100000)

    db[i] = x;
    
    return x

def print_quotes(quotes):
    print quotes
    
def main():

    stock_db = load_stock_db()
    assert(len(stock_db) > 2000)

    # generate quotes for everyone
    for i in range(len(stock_db)):
        quotes = gen_quotes(stock_db,i);
        print_quotes(quotes);

    # random generate
    while True:
        quotes = gen_quotes(stock_db)
        time.sleep(0.001) 
        print_quotes(quotes)

if __name__ == "__main__":
    main()
