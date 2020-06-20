#!/usr/bin/env bash

DIR=$(cd `dirname $0` && pwd)
echo "DIR: ${DIR}"

cd ${DIR}/monolith
yarn

cd ${DIR}/microservices/request-response/order
yarn
cd ${DIR}/microservices/request-response/payment
yarn
cd ${DIR}/microservices/request-response/shipping
yarn

cd ${DIR}/microservices/orchestration/create-order
yarn
cd ${DIR}/microservices/orchestration/create-payment
yarn
cd ${DIR}/microservices/orchestration/create-shipping
yarn
cd ${DIR}/microservices/orchestration/process-order
yarn
cd ${DIR}/microservices/orchestration/process-payment
yarn
cd ${DIR}/microservices/orchestration/process-shipping
yarn
cd ${DIR}/microservices/orchestration/reconcile-order
yarn
cd ${DIR}/microservices/orchestration/reconcile-payment
yarn
cd ${DIR}/microservices/orchestration/reconcile-shipping
yarn