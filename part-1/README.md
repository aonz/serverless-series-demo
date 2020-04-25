# Part 1 - Building and deploying your serverless applications with AWS Lambda, Amazon API Gateway and AWS SAM

# Step 1 - Initialize, build and deploy new SAM project.

```
sam init

cd sam-app

sam build

sam deploy --guided

# Use AWS Region: ap-southeast-1

export BASE_URL=
curl ${BASE_URL}/hello

echo ".aws-sam/" > .gitignore
echo "samconfig.toml" >> .gitignore
git add -A
git commit -a -m 'Step 1 - Initialize, build and deploy new SAM project.'
```

# Step 2 - Logging, Testing and Debugging.

```
sam build && sam deploy

# Logging
sam logs -n HelloWorldFunction --stack-name sam-app --tail
curl ${BASE_URL}/hello

# Testing and Debugging
sam local invoke "HelloWorldFunction" -e events/event.json

# Add breakpoint

sam local generate-event apigateway aws-proxy --body "" --path "hello" --method GET > ./events/api-event.json

sam local start-api
curl http://127.0.0.1:3000/hello

cd hello-world
yarn
yarn test
cd ..

echo "node_modules/" >> .gitignore
git add -A
git commit -a -m 'Step 2 - Logging, Testing and Debugging.'
```

# Step 3 - Invoking another Lamda function and Tracing with AWS X-Ray.

```
mkdir -p echo
cd echo
yarn init
touch app.js

yarn add aws-sdk aws-xray-sdk-core

sam build && sam deploy

sam logs -n EchoFunction --stack-name sam-app --tail
curl ${BASE_URL}/hello

sam local start-api

sam local start-lambda

aws lambda invoke --function-name HelloWorldFunction --endpoint-url http://127.0.0.1:3001/ --payload file://events/event.json output.txt

echo "output.txt" >> .gitignore
git add -A
git commit -a -m 'Step 3 - Invoking another Lamda function and Tracing with AWS X-Ray.'
```

# Pending features (As of 25 April 2020)

- Support for Lambda Custom Runtime, https://github.com/awslabs/aws-sam-cli/pull/1279
- Support for using `local start-api` with `HttpApi`, https://github.com/awslabs/aws-sam-cli/issues/1641
