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
