const Bottleneck = require("bottleneck");

const limiter = new Bottleneck({
  reservoir: 20, // 10 requests
  reservoirRefreshAmount: 20,
  reservoirRefreshInterval: 10 * 1000, // every 10 seconds
  maxConcurrent: 2, // one at a time
});

const rateLimited = limiter.wrap.bind(limiter); // Cleaner usage

module.exports = {
  rateLimited,
};
