# 让Google Home Mini 说中文

## 建立自己的Google Assistant App
* 登录 [Actions on Google](https://console.actions.google.com/) 新建一个 Assistant app
* Use Dialogflow to add actions to your Assistant app
* Create actions on Dialogflow
* Dialogflow Default language en , API Version V2


## 后端服务部署在Firebase Cloud Function，本地开发环境配置
* npm install -g firebase-tools
* firebase login:ci --no-localhost
* 选择对应的Project或者新建
* 初始化 firebase init functions
* 发布 firebase deploy --only functions

## 配置Dialogflow
* 在Fulfillment开启Webhook, 填入 发布后的Firebase Cloud Function地址：https://us-central1-projectid.cloudfunctions.net/function


## Google Home Mini 现在还不能读中文，需要通过百度TTS把文本转成音频播放
* 设置百度语音合成App参数 firebase functions:config:set baidu.app_id="THE API ID" baidu.api_key="THE API KEY" baidu.secret_key="THE SECRET KEY"
