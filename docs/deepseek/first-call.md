Skip to main content
DeepSeek API Docs Logo
DeepSeek API Docs
English
DeepSeek Platform

Quick Start
Your First API Call
Models & Pricing
The Temperature Parameter
Token & Token Usage
Rate Limit
Error Codes
News
DeepSeek-R1 Release 2025/01/20
DeepSeek APP 2025/01/15
Introducing DeepSeek-V3 2024/12/26
DeepSeek-V2.5-1210 Release 2024/12/10
DeepSeek-R1-Lite Release 2024/11/20
DeepSeek-V2.5 Release 2024/09/05
Context Caching is Available 2024/08/02
New API Features 2024/07/25
API Reference
API Guides
Reasoning Model (deepseek-reasoner)
Multi-round Conversation
Chat Prefix Completion (Beta)
FIM Completion (Beta)
JSON Output
Function Calling
Context Caching
Other Resources
Integrations
API Status Page
FAQ
Change Log
Quick StartYour First API Call
Your First API Call
The DeepSeek API uses an API format compatible with OpenAI. By modifying the configuration, you can use the OpenAI SDK or softwares compatible with the OpenAI API to access the DeepSeek API.

PARAM	VALUE
base_url *       	https://api.deepseek.com
api_key	apply for an API key
* To be compatible with OpenAI, you can also use https://api.deepseek.com/v1 as the base_url. But note that the v1 here has NO relationship with the model's version.

* The deepseek-chat model has been upgraded to DeepSeek-V3. The API remains unchanged. You can invoke DeepSeek-V3 by specifying model='deepseek-chat'.

* deepseek-reasoner is the latest reasoning model, DeepSeek-R1, released by DeepSeek. You can invoke DeepSeek-R1 by specifying model='deepseek-reasoner'.

Invoke The Chat API
Once you have obtained an API key, you can access the DeepSeek API using the following example scripts. This is a non-stream example, you can set the stream parameter to true to get stream response.

curl
python
nodejs
// Please install OpenAI SDK first: `npm install openai`

import OpenAI from "openai";

const openai = new OpenAI({
        baseURL: 'https://api.deepseek.com',
        apiKey: '<DeepSeek API Key>'
});

async function main() {
  const completion = await openai.chat.completions.create({
    messages: [{ role: "system", content: "You are a helpful assistant." }],
    model: "deepseek-chat",
  });

  console.log(completion.choices[0].message.content);
}

main();

Next
Models & Pricing
Invoke The Chat API
WeChat Official Account
WeChat QRcode
Community
Email
Discord
Twitter
More
GitHub
Copyright © 2025 DeepSeek, Inc.