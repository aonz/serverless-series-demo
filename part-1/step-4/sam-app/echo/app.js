const logger = require('/opt/nodejs/logger');

exports.lambdaHandler = async (event, context) => {
  logger.log(event, context);
  return event;
};
