import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:flutter_shop/features/cart/data/cart_item.dart';
import 'package:flutter_shop/features/cart/data/cart_repository.dart';

class _MockDio extends Mock implements Dio {}

Response<dynamic> _ok(dynamic data, String path) => Response<dynamic>(
      data: data,
      statusCode: 200,
      requestOptions: RequestOptions(path: path),
    );

void main() {
  late _MockDio dio;
  late CartRepository repository;

  setUp(() {
    dio = _MockDio();
    repository = CartRepository(dio);
  });

  test('fetchCart maps every item', () async {
    when(() => dio.get<dynamic>(any())).thenAnswer(
      (_) async => _ok([
        {'id': 'c1', 'product_id': 'p1', 'title': 'Sneaker', 'unit_price': 89.0, 'quantity': 2},
      ], '/cart/items'),
    );

    final items = await repository.fetchCart();

    expect(items, hasLength(1));
    expect(items.single.lineTotal, 178.0);
  });

  test('removeItem deletes by id', () async {
    when(() => dio.delete<dynamic>(any())).thenAnswer((_) async => _ok(null, '/cart/items/c1'));

    await repository.removeItem('c1');

    verify(() => dio.delete<dynamic>('/cart/items/c1')).called(1);
  });

  test('addItem posts the product id and quantity', () async {
    const item = CartItem(id: 'local-p1', productId: 'p1', title: 'Sneaker', unitPrice: 89, quantity: 1);
    when(() => dio.post<dynamic>(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => _ok({'id': 'c9', 'product_id': 'p1', 'title': 'Sneaker', 'unit_price': 89, 'quantity': 1}, '/cart/items'),
    );

    final saved = await repository.addItem(item);

    expect(saved.id, 'c9');
  });
}
