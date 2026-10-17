// Publishing a sales link requires observed account and fulfilment evidence.
// This file contains no payment credentials. The provider owns payment and delivery.
export function validateCommerce(c){
 if(c.schema!==1||c.provider!=='lemon-squeezy'||c.billing!=='one-time'||c.currency!=='USD'||c.price!==12)throw Error('Unexpected product configuration');
 const requirements=['sellerApproved','liveCheckoutVerified','deliveryVerified','refundRouteVerified','salesDisclosureComplete'];
 if(c.stage!=='live')return {enabled:false,reason:'Seller onboarding and verification are incomplete'};
 if(requirements.some(k=>c[k]!==true))throw Error('Live checkout cannot open without all required evidence');
 if(!c.supportEmail||!c.sellerDisplayName||!/^\S+@\S+\.\S+$/.test(c.supportEmail))throw Error('Seller contact is missing');
 if(!c.storeId||!c.productId||!c.variantId)throw Error('Product identity is missing');
 const u=new URL(c.checkoutUrl);
 if(u.protocol!=='https:'||!u.hostname.endsWith('.lemonsqueezy.com')||u.username||u.password||u.search||u.hash||!/^\/(checkout\/)?buy\/[a-zA-Z0-9-]+$/.test(u.pathname))throw Error('Expected verified live hosted checkout URL');
 return {enabled:true,url:u.href};
}
