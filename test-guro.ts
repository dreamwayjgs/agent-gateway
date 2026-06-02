import { deleteCar, getVisitCars } from "./src/tools/guro";

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

const cars = await getVisitCars(today, tomorrow);
const target = cars.find(c => c.startdateTime.startsWith("2026-06-03"));
console.log("삭제 대상:", target);

if (target) {
  const result = await deleteCar(target.carNo, target.recordTime, target.startdateTime, target.enddateTime, target.no);
  console.log("결과:", result);
} else {
  console.log("6월 3일 차량 없음");
}
