#include <bits/stdc++.h>

using namespace std;

// 將 RGBA 轉換為一個 32-bit 整數
// 第一個 byte (MSB) 是 R，最後一個 byte (LSB) 是 A
unsigned int toRGBAInt(int r, int g, int b, int a) {
    return ((unsigned int)(r & 0xFF) << 24) |
           ((unsigned int)(g & 0xFF) << 16) |
           ((unsigned int)(b & 0xFF) << 8)  |
           ((unsigned int)(a & 0xFF));
}

int main() {
    srand(time(NULL));
    
    vector<string> bodyParts = {
        "hat", "face", "chestL", "chestR", "armL", "armR", 
        "tie", "belt", "gloveL", "gloveR", "legL", "legR", 
        "shoeL", "shoeR", "board"
    };
    
    int playerCount = 7;
    int dataCount = 2;
    int timeRange = 1500;
    int partCount = bodyParts.size();

    // 目前需求：亮度最高。
    // 假設顏色為白色 (R=255, G=255, B=255)，亮度 A 也是最高 (255)
    unsigned int whiteFullBright = toRGBAInt(255, 255, 255, 255); 

    cout << "{\n  \"players\": [\n";

    for (int p = 0; p < playerCount; p++) {
        vector<pair<int, vector<unsigned int>>> frames(dataCount);
        vector<int> used(timeRange, 0);
        
        for (int i = 0; i < dataCount; i++) {
            int t = rand() % timeRange;
            while (used[t]) t = rand() % timeRange;
            used[t] = 1;
            
            frames[i].first = t;
            frames[i].second.assign(partCount, whiteFullBright);
        }
        
        sort(frames.begin(), frames.end());

        cout << "    [\n";
        for (int i = 0; i < dataCount; i++) {
            cout << "      {\"time\": " << frames[i].first;
            for (int j = 0; j < partCount; j++) {
                // 輸出為十進位整數，韌體端讀取後會是 0xFFFFFFFF
                cout << ", \"" << bodyParts[j] << "\": " << frames[i].second[j];
            }
            cout << "}" << (i == dataCount - 1 ? "" : ",") << "\n";
        }
        cout << "    ]" << (p == playerCount - 1 ? "" : ",") << "\n";
    }

    cout << "  ]\n}";
    return 0;
}