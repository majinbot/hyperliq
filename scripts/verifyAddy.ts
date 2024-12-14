import { verifyEthAddress } from '../src';

const testPrivateKey = "0x304aa141b54471754c2233e856c66a0cdad97a771b0552d8be547128ee2e020c"
const testAddress = "0xb00396a53d0b9456b0ac44c1f142b8c26edace5d"

console.log("Verification with address:", verifyEthAddress(testPrivateKey, testAddress))
console.log("Verification without address:", verifyEthAddress(testPrivateKey))