const Bottleneck = require("bottleneck");

const limiter = new Bottleneck({
  reservoir: 100, // 10 requests
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 10 * 1000, // every 10 seconds
  maxConcurrent: 1, // one at a time
});

const rateLimited = limiter.wrap.bind(limiter); // Cleaner usage

module.exports = {
  rateLimited,
};
