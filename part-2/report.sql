CREATE TABLE IF NOT EXISTS report (
  item VARCHAR(255) PRIMARY KEY,
  title VARCHAR(255),
  pending INT,
  processed INT,
  total INT
);
--
-- INSERT INTO report (item, title, pending, processed, total)
-- VALUES('Item-1', 'Item 1', 3, 7, 10);
--
SELECT
  *
FROM report;