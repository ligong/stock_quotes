# 股票行情模拟器

## 安装使用
1. 按照 nodejs,npm, 要求node用0.10以上版本

$node --version   # 检查版本
v0.10.5

2. 下载github上的代码
$git clone http://www.github.com/ligong/stock_quotes

3. 启动消息服务器
$cd stock_quotes/yamq

$./start_server

4. 启动数据模拟
$cd stock_quotes/simulator

$./simulator

5. 启动web应用
$cd stock_quotes/webapp

$node app.js

6. 在浏览器输入 http://localhost:3000/

   随意输入有效的A股代码, e.g. 600070
   
   可以观察到数据的实时更新

## 代码结构
### /simulator 行情数据模拟
* /simulator/quotes_simulator.py  模拟产生行情数据，输出json数据到stdout, 一行一个行情数据
* /simulator/send_outbox.js       从stdin读入行，向消息队列发送
* /simulator/simulator            shell脚本,启动模拟器
* /simulator/build_stock_db.py    抓取A股数据，存放到stock_db.json
* /simulator/stock_db.json        A股数据,被quotes_simulator.py使用

### /yamq 消息服务
* /yamq/broker.js                 消息服务器
* /yamq/client.js                 消息服务器客户端API
* /yamq/start_server              shell脚本，启动消息服务器
* /yamq/util.js                   辅助函数
* /yamq/debug.js                  调试输出辅助函数

### /webapp  web应用(基于express+jade+socket.io)
* /webapp/app.js                  应用入口
* /webapp/io_event_handlers.js    事件处理函数
* /webapp/views/index.jade        页面模版
* /webapp/public/js/stock.js      浏览器端的js程序



