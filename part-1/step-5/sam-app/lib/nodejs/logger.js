exports.log = (event, context) => {
  console.log(`Node.js version: ${process.version}`);
  console.log('Logger...');
  console.log('Event: ', JSON.stringify(event, null, 2));
  console.log('Context: ', JSON.stringify(context, null, 2));
};
