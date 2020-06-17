-- Monilith
CREATE TABLE IF NOT EXISTS shop.`order` (
  id VARCHAR(255) PRIMARY KEY,
  `status` VARCHAR(10)
);
CREATE TABLE IF NOT EXISTS shop.payment (
  id VARCHAR(255) PRIMARY KEY,
  `status` VARCHAR(10),
  amount INT
);
CREATE TABLE IF NOT EXISTS shop.shipping (
  id VARCHAR(255) PRIMARY KEY,
  `status` VARCHAR(10),
  quantity INT
);
-- Microservices
CREATE DATABASE IF NOT EXISTS `order`;
CREATE TABLE IF NOT EXISTS `order`.`order` (
  id VARCHAR(255) PRIMARY KEY,
  `status` VARCHAR(10)
);
CREATE DATABASE IF NOT EXISTS `payment`;
CREATE TABLE IF NOT EXISTS payment.payment (
  id VARCHAR(255) PRIMARY KEY,
  `status` VARCHAR(10),
  amount INT
);
CREATE DATABASE IF NOT EXISTS `shipping`;
CREATE TABLE IF NOT EXISTS shipping.shipping (
  id VARCHAR(255) PRIMARY KEY,
  `status` VARCHAR(10),
  quantity INT
);
-- DROP TABLE shop.`order`;
-- DROP TABLE shop.payment;
-- DROP TABLE shop.shipping;
-- DROP TABLE `order`.`order`;
-- DROP TABLE payment.payment;
-- DROP TABLE shipping.shipping;
SELECT o.id AS OrderID,
  o.status AS OrderStatus,
  p.status AS PaymentStatus,
  p.amount AS PaymentAmount,
  s.status AS ShippingStatus,
  s.quantity AS ShippingQuantity
FROM `order` o,
  payment p,
  shipping s
WHERE o.id = p.id
  AND o.id = s.id;