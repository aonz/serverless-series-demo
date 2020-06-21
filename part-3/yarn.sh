#!/usr/bin/env bash

DIR=$(cd `dirname $0` && pwd)
echo "DIR: ${DIR}"

cd ${DIR}/monolith
rm -rf node_modules
yarn

cd ${DIR}/microservices/request-response/order
rm -rf node_modules
yarn
cd ${DIR}/microservices/request-response/payment
rm -rf node_modules
yarn
cd ${DIR}/microservices/request-response/shipping
rm -rf node_modules
yarn

cd ${DIR}/microservices/orchestration/create-order
rm -rf node_modules
yarn
cd ${DIR}/microservices/orchestration/create-payment
rm -rf node_modules
yarn
cd ${DIR}/microservices/orchestration/create-shipping
rm -rf node_modules
yarn
cd ${DIR}/microservices/orchestration/process-order
rm -rf node_modules
yarn
cd ${DIR}/microservices/orchestration/process-payment
rm -rf node_modules
yarn
cd ${DIR}/microservices/orchestration/process-shipping
rm -rf node_modules
yarn
cd ${DIR}/microservices/orchestration/reconcile-order
rm -rf node_modules
yarn
cd ${DIR}/microservices/orchestration/reconcile-payment
rm -rf node_modules
yarn
cd ${DIR}/microservices/orchestration/reconcile-shipping
rm -rf node_modules
yarn

cd ${DIR}/microservices/choreography/order-context
rm -rf node_modules
yarn
cd ${DIR}/microservices/choreography/create-order
rm -rf node_modules
yarn
cd ${DIR}/microservices/choreography/create-payment
rm -rf node_modules
yarn
cd ${DIR}/microservices/choreography/create-shipping
rm -rf node_modules
yarn
cd ${DIR}/microservices/choreography/process-order
rm -rf node_modules
yarn
cd ${DIR}/microservices/choreography/process-payment
rm -rf node_modules
yarn
cd ${DIR}/microservices/choreography/process-shipping
rm -rf node_modules
yarn
cd ${DIR}/microservices/choreography/reconcile-order
rm -rf node_modules
yarn
cd ${DIR}/microservices/choreography/reconcile-payment
rm -rf node_modules
yarn
cd ${DIR}/microservices/choreography/reconcile-shipping
rm -rf node_modules
yarn