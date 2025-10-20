using System;
using Microsoft.Data.SqlClient;

class Program
{
    static void Main()
    {
        var connectionString = "Server=localhost,1433;Database=SampleDB;User Id=sa;Password=Ninnniku2029;Encrypt=False;";
        
        using var connection = new SqlConnection(connectionString);
        connection.Open();

        Console.Write("名前を入力してください: ");
        var name = Console.ReadLine();

        Console.Write("年齢を入力してください: ");
        var age = Console.ReadLine();

        var insertCommand = new SqlCommand(
            "INSERT INTO Users (Name, Age) VALUES (@name, @age)", connection);
        insertCommand.Parameters.AddWithValue("@name", name);
        insertCommand.Parameters.AddWithValue("@age", int.Parse(age));
        insertCommand.ExecuteNonQuery();

        Console.WriteLine("\n登録されたユーザー一覧：");

        var selectCommand = new SqlCommand("SELECT Name, Age FROM Users", connection);
        using var reader = selectCommand.ExecuteReader();
        while (reader.Read())
        {
            Console.WriteLine($"- {reader["Name"]}（{reader["Age"]}歳）");
        }
    }
}