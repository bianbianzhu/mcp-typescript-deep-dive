const 快递员的交通方式 = new 电瓶车的交通方式({
  地址: ["x市", "xxx路", "xx号"],
});

const coles_快递专员 = new 快递员({
  name: "专门给coles超市送货的快递员",
  version: "1.0.0",
});

await coles_快递专员.看看超市开不开门(快递员的交通方式);

// List tools
const 商品列表 = await coles_快递专员.看看超市今天具体卖什么();

console.log(商品列表);

// Call a tool
const 商品 = await coles_快递专员.购买({
  名称: "牛奶",
  备注: {
    数量: 2,
  },
});

console.log(商品);
